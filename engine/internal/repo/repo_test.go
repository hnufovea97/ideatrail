package repo

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cloudflare/circl/kem"

	"ideatrail/engine/internal/api"
	ic "ideatrail/engine/internal/crypto"
	gh "ideatrail/engine/internal/github"
	"ideatrail/engine/internal/github/githubtest"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/record"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/testsrv"
)

const testUser = "01jcm3v8q7s2kx4f9d6b5n0tqw"

type env struct {
	d      Deps
	gh     *githubtest.Fake
	srv    *testsrv.Server
	akPriv kem.PrivateKey
	mu     sync.Mutex
	link   map[string]any
	heads  []map[string]any
	synced []string
	bodies []string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	base := t.TempDir()
	engine := filepath.Join(base, "engine")
	_ = os.Mkdir(engine, 0o700)
	k, _ := keys.LoadOrCreate(engine)
	e := &env{gh: githubtest.New(t), srv: testsrv.New()}
	t.Cleanup(e.srv.Close)
	e.srv.AddEngine(k.EngineID, k.SignPub())
	e.srv.Handle("PUT", "/v1/storage-link", func(w http.ResponseWriter, r *http.Request, body []byte, _ string) {
		e.mu.Lock()
		defer e.mu.Unlock()
		e.bodies = append(e.bodies, string(body))
		_ = json.Unmarshal(body, &e.link)
		testsrv.JSON(w, 200, map[string]any{})
	})
	e.srv.Handle("POST", "/v1/repo-heads", func(w http.ResponseWriter, r *http.Request, body []byte, _ string) {
		var b map[string]any
		_ = json.Unmarshal(body, &b)
		e.mu.Lock()
		e.heads = append(e.heads, b)
		e.mu.Unlock()
		testsrv.JSON(w, 201, map[string]any{})
	})
	e.srv.Handle("POST", "/v1/anchors/:id/synced", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		e.mu.Lock()
		e.synced = append(e.synced, r.URL.Path)
		e.mu.Unlock()
		testsrv.JSON(w, 200, map[string]any{})
	})
	sk, pk, _ := ic.GenerateKEMKey(rand.Reader)
	e.akPriv = sk
	pkRaw, _ := pk.MarshalBinary()
	_ = state.With(engine, func(s *state.State) error { s.UserID, s.AccountPub = testUser, ic.B64(pkRaw); return nil })
	c, _ := api.New(e.srv.URL, k, engine)
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/code") {
			_, _ = w.Write([]byte(`{"device_code":"dc","user_code":"ABCD-1234","expires_in":900,"interval":5}`))
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"ghu_SECRET_TOKEN"}`))
	}))
	t.Cleanup(tokenSrv.Close)
	flow := &gh.DeviceFlow{ClientID: "Iv1", CodeURL: tokenSrv.URL + "/code", TokenURL: tokenSrv.URL + "/token",
		Open: func(string) error { return nil }, ShowCode: func(string) error { return nil },
		Sleep: func(context.Context, time.Duration) error { return nil }}
	e.d = Deps{API: c, Keys: k, StateDir: engine, OutboxDir: filepath.Join(base, "outbox"), GitHubBase: e.gh.URL, Flow: flow,
		Sleep: func(context.Context, time.Duration) error { return nil }}
	return e
}

func (e *env) queue(t *testing.T, seq uint64, id string, update bool, files map[string]string) {
	t.Helper()
	kind := "record"
	if update {
		kind = "update"
	}
	enc := map[string]string{}
	for p, v := range files {
		enc[p] = ic.B64([]byte(v))
	}
	b, _ := json.Marshal(map[string]any{"v": 1, "kind": kind, "record_id": id, "files": enc})
	_ = os.MkdirAll(e.d.OutboxDir, 0o700)
	if err := os.WriteFile(filepath.Join(e.d.OutboxDir, record.OutboxName(seq, id, update)), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestConnectStoresTokenOwnerOnlyAndUploadsItSealed(t *testing.T) {
	e := newEnv(t)
	if err := Connect(context.Background(), e.d); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(e.d.StateDir, githubFile))
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("github.json %v %v", fi, err)
	}
	sealed, _ := ic.UnB64(e.link["enc_token"].(string))
	pt, err := ic.Open(ic.KindStorageToken, e.akPriv, ic.AAD{UserID: testUser, Version: "0"}, sealed)
	if err != nil {
		t.Fatal(err)
	}
	var tok map[string]any
	_ = json.Unmarshal(pt, &tok)
	if tok["token"] != "ghu_SECRET_TOKEN" || tok["repo_full_name"] != "steven/ideatrail-proofs" {
		t.Fatalf("%v", tok)
	}
	for _, b := range e.bodies {
		if strings.Contains(b, "ghu_SECRET_TOKEN") {
			t.Fatal("token travelled in plaintext to the server")
		}
	}
	st, _ := state.Read(e.d.StateDir)
	if st.RepoFullName != "steven/ideatrail-proofs" {
		t.Fatal(st.RepoFullName)
	}
}

func TestNothingPushedBeforeConnecting(t *testing.T) {
	e := newEnv(t)
	e.queue(t, 1, "01jcm3v8q7s2kx4f9d6b5n0tqx", false, map[string]string{"records/01jcm3v8q7s2kx4f9d6b5n0tqx.it1": "sealed"})
	if _, err := PushOutbox(context.Background(), e.d); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("got %v", err)
	}
}

func TestPushInOrderUpdatesAfterRecordsAndDedupes(t *testing.T) {
	e := newEnv(t)
	if err := Connect(context.Background(), e.d); err != nil {
		t.Fatal(err)
	}
	a, b := "01jcm3v8q7s2kx4f9d6b5n0tqx", "01jcm3v8q7s2kx4f9d6b5n0tqy"
	e.queue(t, 2, b, false, map[string]string{"records/" + b + ".it1": "B", "proofs/" + b + "/bundle.json": "{}"})
	e.queue(t, 1, a, true, map[string]string{"proofs/" + a + "/bundle.json": `{"confirmed":true}`})
	e.queue(t, 1, a, false, map[string]string{"records/" + a + ".it1": "A", "proofs/" + a + "/bundle.json": "{}"})
	n, err := PushOutbox(context.Background(), e.d)
	if err != nil || n != 3 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	files := e.gh.Files("steven/ideatrail-proofs")
	if files["proofs/"+a+"/bundle.json"] != `{"confirmed":true}` || files["records/"+b+".it1"] != "B" {
		t.Fatalf("update applied before record or lost: %v", files)
	}
	if left, _ := queued(e.d.OutboxDir); len(left) != 0 || len(e.heads) != 1 || len(e.synced) != 1 {
		t.Fatalf("left=%v heads=%d synced=%v", left, len(e.heads), e.synced)
	}
	// a re-queued record already in the repo is not committed again
	before := e.gh.CommitCount("steven/ideatrail-proofs")
	e.queue(t, 1, a, false, map[string]string{"records/" + a + ".it1": "A"})
	if _, err := PushOutbox(context.Background(), e.d); err != nil {
		t.Fatal(err)
	}
	if e.gh.CommitCount("steven/ideatrail-proofs") != before {
		t.Fatal("duplicate commit")
	}
}

func TestQueueItemWithUnexpectedPathIsRefused(t *testing.T) {
	e := newEnv(t)
	_ = Connect(context.Background(), e.d)
	e.queue(t, 1, "01jcm3v8q7s2kx4f9d6b5n0tqx", false, map[string]string{".github/workflows/x.yml": "evil"})
	if _, err := PushOutbox(context.Background(), e.d); err == nil {
		t.Fatal("unexpected path accepted")
	}
	if _, ok := e.gh.Files("steven/ideatrail-proofs")[".github/workflows/x.yml"]; ok {
		t.Fatal("workflow file committed")
	}
}
