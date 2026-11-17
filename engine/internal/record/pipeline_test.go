package record

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/cloudflare/circl/kem"

	"ideatrail/engine/internal/api"
	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/ots"
	"ideatrail/engine/internal/pathguard"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/testsrv"
)

const (
	testUser = "01jcm3v8q7s2kx4f9d6b5n0tqw"
	testRoot = "01jcm3v8q7s2kx4f9d6b5n0tqx"
)

type env struct {
	d       Deps
	srv     *testsrv.Server
	folder  string
	akPriv  kem.PrivateKey
	mu      sync.Mutex
	records map[string]map[string]any
	order   []string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Cleanup(ots.AllowLoopbackForTesting())
	base, _ := filepath.EvalSymlinks(t.TempDir())
	engineDir := filepath.Join(base, "engine")
	_ = os.Mkdir(engineDir, 0o700)
	k, err := keys.LoadOrCreate(engineDir)
	if err != nil {
		t.Fatal(err)
	}
	e := &env{srv: testsrv.New(), folder: filepath.Join(base, "가계부 앱"), records: map[string]map[string]any{}}
	t.Cleanup(e.srv.Close)
	e.srv.AddEngine(k.EngineID, k.SignPub())
	e.srv.Handle("POST", "/v1/records", func(w http.ResponseWriter, r *http.Request, body []byte, _ string) {
		var b map[string]any
		_ = json.Unmarshal(body, &b)
		e.mu.Lock()
		defer e.mu.Unlock()
		id := b["record_id"].(string)
		if _, ok := e.records[id]; ok {
			testsrv.JSON(w, 200, map[string]any{"record_id": id, "duplicate": true})
			return
		}
		e.records[id] = b
		e.order = append(e.order, id)
		testsrv.JSON(w, 201, map[string]any{"record_id": id})
	})
	_ = os.MkdirAll(filepath.Join(e.folder, "docs"), 0o700)
	sk, pk, _ := ic.GenerateKEMKey(rand.Reader)
	e.akPriv = sk
	pkRaw, _ := pk.MarshalBinary()
	_ = state.With(engineDir, func(s *state.State) error {
		s.UserID, s.AccountPub = testUser, ic.B64(pkRaw)
		s.Folders = map[string]string{e.folder: testRoot}
		return nil
	})
	c, _ := api.New(e.srv.URL, k, engineDir)
	cals := fakeCalendars(t)
	e.d = Deps{API: c, Keys: k, StateDir: engineDir, ProofDir: filepath.Join(base, "proofs"), OutboxDir: filepath.Join(base, "outbox"), Calendars: cals}
	return e
}

func fakeCalendars(t *testing.T) []string {
	t.Helper()
	raw, _ := os.ReadFile("../../../spec/vectors/ots/receipts.json")
	var fx struct {
		A string `json:"pending_alice_hex"`
		B string `json:"pending_bob_hex"`
	}
	_ = json.Unmarshal(raw, &fx)
	var urls []string
	for _, h := range []string{fx.A, fx.B} {
		b, _ := hex.DecodeString(h)
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(b) }))
		t.Cleanup(s.Close)
		urls = append(urls, s.URL)
	}
	return urls
}

func (e *env) file(t *testing.T, rel, content string) string {
	t.Helper()
	p := filepath.Join(e.folder, filepath.FromSlash(rel))
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	_ = os.WriteFile(p, []byte(content), 0o600)
	return p
}

func (e *env) record(t *testing.T, paths ...string) *Result {
	t.Helper()
	r, err := Record(context.Background(), e.d, Input{Paths: paths, Note: "MVP 범위를 정했다", Milestone: "plan_decided", Tags: []string{"finance"}})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestRecordEndToEnd(t *testing.T) {
	e := newEnv(t)
	r := e.record(t, e.file(t, "docs/plan.md", "# 가계부 앱 기획"))
	if r.Status != "sent" || r.Title != "가계부 앱" || r.RootID != testRoot {
		t.Fatalf("%+v", r)
	}
	body := e.records[r.RecordID]
	// server body shape = api/src/routes/records.ts
	for _, k := range []string{"record_id", "root_id", "parent_ids", "commitment", "manifest", "recorded_at", "log_seq", "list_meta", "body_hash", "nonce_hash", "engine_sig", "ots"} {
		if _, ok := body[k]; !ok {
			t.Fatalf("missing %s", k)
		}
	}
	if body["log_seq"] != "1" || len(body["ots"].([]any)) != 2 {
		t.Fatalf("%v %v", body["log_seq"], body["ots"])
	}
	// the account key (browser) can open the list meta
	meta, _ := ic.UnB64(body["list_meta"].(string))
	pt, err := ic.Open(ic.KindRecordMeta, e.akPriv, ic.AAD{UserID: testUser, RootID: testRoot, RecordID: r.RecordID, Version: "0"}, meta)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	_ = json.Unmarshal(pt, &m)
	if m["title"] != "가계부 앱" || m["milestone"] != "plan_decided" || len(m["files"].([]any)) != 1 {
		t.Fatalf("meta %v", m)
	}
	// local copy has the plaintext nonce; the GitHub queue has the sealed one
	var local map[string]any
	lb, _ := os.ReadFile(filepath.Join(e.d.ProofDir, r.RecordID, "bundle.json"))
	_ = json.Unmarshal(lb, &local)
	if len(local["nonce"].(string)) != 64 || local["engine_sig"] != body["engine_sig"] {
		t.Fatalf("local bundle %v", local)
	}
	if n := countEntries(e.d.OutboxDir); n != 1 {
		t.Fatalf("outbox %d", n)
	}
	// journal: ids and status only
	j, _ := os.ReadFile(filepath.Join(e.d.StateDir, "journal.log"))
	for _, leak := range []string{"MVP", "plan.md", "가계부"} {
		if strings.Contains(string(j), leak) {
			t.Fatalf("journal leaks %q", leak)
		}
	}
}

func TestVersionChainAndOrder(t *testing.T) {
	e := newEnv(t)
	a := e.record(t, e.file(t, "a.md", "v1"))
	b := e.record(t, e.file(t, "a.md", "v2"))
	parents := e.records[b.RecordID]["parent_ids"].([]any)
	if len(parents) != 1 || parents[0] != a.RecordID || e.records[b.RecordID]["log_seq"] != "2" {
		t.Fatalf("parents %v", parents)
	}
}

func TestServerDownQueuesThenSendsInOrderWithSameBody(t *testing.T) {
	e := newEnv(t)
	e.srv.FailNext(3, 503) // all three attempts of the first upload fail
	first := e.record(t, e.file(t, "a.md", "one"))
	if first.Status != "queued" || len(e.records) != 0 {
		t.Fatalf("%+v", first)
	}
	second := e.record(t, e.file(t, "b.md", "two"))
	if second.Status != "sent" || len(e.order) != 2 || e.order[0] != first.RecordID {
		t.Fatalf("order %v", e.order)
	}
	if e.records[first.RecordID]["log_seq"] != "1" {
		t.Fatal("retry must keep the original log_seq")
	}
	st, _ := state.Read(e.d.StateDir)
	if len(st.PendingUploads) != 0 {
		t.Fatalf("pending %v", st.PendingUploads)
	}
}

func TestRefusalBlocksQueueWithoutSkipping(t *testing.T) {
	e := newEnv(t)
	e.srv.FailNext(1, 400)
	if r := e.record(t, e.file(t, "a.md", "one")); r.Status != "blocked" {
		t.Fatalf("%+v", r)
	}
	if r := e.record(t, e.file(t, "b.md", "two")); r.Status != "blocked" {
		t.Fatalf("%+v", r)
	}
	st, _ := state.Read(e.d.StateDir)
	if len(st.PendingUploads) != 2 || st.LogSeq != 2 || st.Blocked != "unknown" || len(e.records) != 0 {
		t.Fatalf("%+v", st)
	}
}

func TestRefusesOutsideFilesAndUnpaired(t *testing.T) {
	e := newEnv(t)
	outside := filepath.Join(filepath.Dir(e.folder), "notes.txt")
	_ = os.WriteFile(outside, []byte("x"), 0o600)
	if _, err := Record(context.Background(), e.d, Input{Paths: []string{outside}, Note: "n"}); !errors.Is(err, pathguard.ErrNotAllowed) {
		t.Fatalf("got %v", err)
	}
	if _, err := Record(context.Background(), e.d, Input{Paths: []string{e.file(t, ".env", "S=1")}, Note: "n"}); !errors.Is(err, pathguard.ErrNotAllowed) {
		t.Fatalf("got %v", err)
	}
	_ = state.With(e.d.StateDir, func(s *state.State) error { s.AccountPub = ""; return nil })
	if _, err := Record(context.Background(), e.d, Input{Paths: []string{e.file(t, "a.md", "x")}, Note: "n"}); !errors.Is(err, ErrNotPaired) {
		t.Fatalf("got %v", err)
	}
}

func TestEngineSignatureVerifies(t *testing.T) {
	e := newEnv(t)
	r := e.record(t, e.file(t, "a.md", "x"))
	b := e.records[r.RecordID]
	meta, _ := ic.UnB64(b["list_meta"].(string))
	// body/nonce sealed bytes are not sent; the server only gets their hashes → rebuild the message from the outbox copy
	ob, _ := filepath.Glob(filepath.Join(e.d.OutboxDir, "*.json"))
	raw, _ := os.ReadFile(ob[0])
	var out struct{ Files map[string]string }
	_ = json.Unmarshal(raw, &out)
	body, _ := ic.UnB64(out.Files["records/"+r.RecordID+".it1"])
	var gb map[string]any
	gbRaw, _ := ic.UnB64(out.Files["proofs/"+r.RecordID+"/bundle.json"])
	_ = json.Unmarshal(gbRaw, &gb)
	nonce, _ := ic.UnB64(gb["nonce_sealed"].(string))
	msg, err := ic.Record{UserID: testUser, RootID: testRoot, RecordID: r.RecordID, CommitmentHex: b["commitment"].(string),
		MetaSealed: meta, BodySealed: body, NonceSealed: nonce, LogSeq: 1, RecordedAt: b["recorded_at"].(string)}.Message()
	if err != nil || !ic.Verify(e.d.Keys.SignPub(), msg, b["engine_sig"].(string)) {
		t.Fatal("engine signature does not verify")
	}
	if hexSHA(body) != b["body_hash"] {
		t.Fatal("body_hash mismatch")
	}
}

func TestBlockClearsOnNewEngineVersionAndRetries(t *testing.T) {
	e := newEnv(t)
	e.srv.FailNext(1, 400)
	if r := e.record(t, e.file(t, "a.md", "one")); r.Status != "blocked" {
		t.Fatalf("%+v", r)
	}
	old := Version
	Version = "next"
	defer func() { Version = old }()
	if s := Flush(context.Background(), e.d); s != "sent" || len(e.records) != 1 {
		t.Fatalf("status %s, records %d", s, len(e.records))
	}
}

func TestClockSkew401DoesNotBlock(t *testing.T) {
	e := newEnv(t)
	e.srv.FailNext(1, 401)
	if r := e.record(t, e.file(t, "a.md", "one")); r.Status != "queued" {
		t.Fatalf("%+v", r)
	}
}

func TestMissingPendingFileBlocksVisibly(t *testing.T) {
	e := newEnv(t)
	e.srv.FailNext(3, 503)
	r := e.record(t, e.file(t, "a.md", "one"))
	_ = os.Remove(filepath.Join(e.d.StateDir, pendingDir, r.RecordID+".json"))
	if s := Flush(context.Background(), e.d); s != "blocked" {
		t.Fatalf("got %s", s)
	}
	st, _ := state.Read(e.d.StateDir)
	if st.Blocked != "pending_missing" {
		t.Fatalf("blocked %q", st.Blocked)
	}
}

func TestInputLimits(t *testing.T) {
	e := newEnv(t)
	p := e.file(t, "a.md", "x")
	for _, in := range []Input{
		{Paths: []string{p}, Note: strings.Repeat("가", maxNote+1)},
		{Paths: []string{p}, Milestone: "launched_to_mars"},
		{Paths: []string{p}, Tags: []string{"a", "b", "c", "d", "e", "f"}},
		{Paths: []string{p}, Routine: []Routine{{Slot: "ignore_previous_instructions"}}},
	} {
		if _, err := Record(context.Background(), e.d, in); !errors.Is(err, ErrBadInput) {
			t.Errorf("accepted %+v: %v", in.Milestone, err)
		}
	}
}

func TestCrashOrphansAreSwept(t *testing.T) {
	e := newEnv(t)
	_ = os.MkdirAll(filepath.Join(e.d.StateDir, pendingDir), 0o700)
	orphanPending := filepath.Join(e.d.StateDir, pendingDir, "01jcm3v8q7s2kx4f9d6b5n0tqz.json")
	_ = os.WriteFile(orphanPending, []byte("{}"), 0o600)
	_ = os.MkdirAll(e.d.OutboxDir, 0o700)
	orphanOutbox := filepath.Join(e.d.OutboxDir, "00000000000000000001-01jcm3v8q7s2kx4f9d6b5n0tqz.json")
	_ = os.WriteFile(orphanOutbox, []byte("{}"), 0o600)
	r := e.record(t, e.file(t, "a.md", "x"))
	for _, p := range []string{orphanPending, orphanOutbox} {
		if _, err := os.Stat(p); err == nil {
			t.Errorf("orphan %s kept", filepath.Base(p))
		}
	}
	if r.Status != "sent" || countEntries(e.d.OutboxDir) != 1 {
		t.Fatalf("%+v outbox=%d", r, countEntries(e.d.OutboxDir))
	}
}
