package mcpserver

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/cloudflare/circl/kem"

	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/testsrv"
	"ideatrail/engine/internal/update"
)

const gateUser = "01jcm3v8q7s2kx4f9d6b5n0tqx"

// gate is a signed-up user whose engine just started as version 0.2.0 after approving 0.1.0.
type gate struct {
	*env
	acct  kem.PrivateKey
	mu    sync.Mutex
	posts []map[string]any
	inbox []map[string]string
}

func newGate(t *testing.T) *gate {
	t.Helper()
	g := &gate{env: newEnv(t, true)}
	g.e.Version = "0.2.0"
	sk, pk, _ := ic.GenerateKEMKey(rand.Reader)
	g.acct = sk
	raw, _ := pk.MarshalBinary()
	_ = state.With(g.e.StateDir, func(s *state.State) error { s.AccountPub = ic.B64(raw); return nil })
	g.srv.Handle("POST", "/v1/approvals", func(w http.ResponseWriter, r *http.Request, b []byte, _ string) {
		var body map[string]any
		_ = json.Unmarshal(b, &body)
		g.mu.Lock()
		g.posts = append(g.posts, body)
		g.mu.Unlock()
		testsrv.JSON(w, 201, map[string]any{})
	})
	g.srv.Handle("GET", "/v1/inbox", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		g.mu.Lock()
		defer g.mu.Unlock()
		testsrv.JSON(w, 200, map[string]any{"messages": g.inbox})
	})
	g.srv.Handle("DELETE", "/v1/inbox/:id", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		testsrv.JSON(w, 200, map[string]any{})
	})
	if _, err := update.Check(g.e.StateDir, "0.1.0"); err != nil {
		t.Fatal(err)
	}
	st, err := update.Check(g.e.StateDir, "0.2.0")
	if err != nil || !st.Pending {
		t.Fatalf("%+v %v", st, err)
	}
	g.e.UpdateGate = st
	g.e.StartUpdateGate(context.Background())
	return g
}

func (g *gate) answer(t *testing.T, decision string) {
	t.Helper()
	s, _ := state.Read(g.e.StateDir)
	id := s.UpdatePending.ApprovalID
	pt, _ := json.Marshal(map[string]any{"v": 1, "type": "approval_result", "approval_id": id, "decision": decision, "issued_at": ic.FormatTime(time.Now())})
	msgID, _ := ic.NewID(rand.Reader)
	sealed, err := ic.SealAuth(ic.KindEngineInbox, g.e.Keys.KEMPub, g.acct, ic.AAD{UserID: gateUser, RootID: id, RecordID: msgID}, pt)
	if err != nil {
		t.Fatal(err)
	}
	g.mu.Lock()
	g.inbox = []map[string]string{{"msg_id": msgID, "sealed": ic.B64(sealed)}}
	g.mu.Unlock()
}

// settle waits for the background inbox round a blocked call started.
func (g *gate) settle(t *testing.T, want func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !want() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestPendingUpdateSendsExactlyOneRequestAndBlocksTools(t *testing.T) {
	g := newGate(t)
	g.e.StartUpdateGate(context.Background()) // a second call must not make a second request
	if len(g.posts) != 1 || g.posts[0]["kind"] != "update" {
		t.Fatalf("posts %v", g.posts)
	}
	want := update.WaitingLine("0.2.0")
	p := filepath.Join(g.folder, "plan.md")
	_ = os.WriteFile(p, []byte("# plan"), 0o600)
	for name, args := range map[string]any{
		"record":           map[string]any{"paths": []string{p}, "note": "x"},
		"status":           map[string]any{},
		"request_import":   map[string]any{"folders": []string{g.folder}},
		"set_record_words": map[string]any{"words": []string{"박제해"}},
	} {
		if out, _ := g.call(t, name, args); out != want {
			t.Fatalf("%s: %q", name, out)
		}
	}
	if len(g.posts) != 1 {
		t.Fatalf("blocked calls made requests: %d", len(g.posts))
	}
	s, _ := state.Read(g.e.StateDir)
	if len(s.RecordWords) != 0 || s.LogSeq != 0 {
		t.Fatalf("a blocked tool changed state: %+v", s)
	}
}

func TestApprovedUpdateUnlocksToolsWithoutRestart(t *testing.T) {
	g := newGate(t)
	g.answer(t, "approved")
	_, _ = g.call(t, "status", map[string]any{}) // blocked call runs the inbox round
	g.settle(t, func() bool { return update.Pending(g.e.StateDir) == nil })
	out, _ := g.call(t, "status", map[string]any{})
	if out == update.WaitingLine("0.2.0") || out == update.RejectedLine {
		t.Fatalf("still blocked: %q", out)
	}
	p := filepath.Join(g.folder, "plan.md")
	_ = os.WriteFile(p, []byte("# plan"), 0o600)
	if out, _ := g.call(t, "record", map[string]any{"paths": []string{p}, "note": "x"}); out == update.WaitingLine("0.2.0") {
		t.Fatalf("record still blocked: %q", out)
	}
	if s, _ := state.Read(g.e.StateDir); s.ApprovedVersion != "0.2.0" {
		t.Fatalf("approved %q", s.ApprovedVersion)
	}
}

func TestRejectedUpdateStaysBlockedWithRejectedLine(t *testing.T) {
	g := newGate(t)
	g.answer(t, "rejected")
	_, _ = g.call(t, "status", map[string]any{})
	g.settle(t, func() bool { p := update.Pending(g.e.StateDir); return p != nil && p.Rejected })
	if out, _ := g.call(t, "status", map[string]any{}); out != update.RejectedLine {
		t.Fatalf("%q", out)
	}
	if out, _ := g.call(t, "record", map[string]any{"paths": []string{"a.md"}, "note": "x"}); out != update.RejectedLine {
		t.Fatalf("%q", out)
	}
	if len(g.posts) != 1 {
		t.Fatalf("a rejected update asked again in the same run: %d", len(g.posts))
	}
}

func TestRestartAfterRejectionAsksOnceMore(t *testing.T) {
	g := newGate(t)
	g.answer(t, "rejected")
	_, _ = g.call(t, "status", map[string]any{})
	g.settle(t, func() bool { p := update.Pending(g.e.StateDir); return p != nil && p.Rejected })
	st, _ := update.Check(g.e.StateDir, "0.2.0")
	g.e.UpdateGate = st
	g.e.StartUpdateGate(context.Background())
	p := update.Pending(g.e.StateDir)
	if len(g.posts) != 2 || p == nil || p.Rejected || p.ApprovalID == "" {
		t.Fatalf("posts=%d pending=%+v", len(g.posts), p)
	}
}

func TestNotSignedUpIsNeverBlocked(t *testing.T) {
	e := newEnv(t, false)
	_, _ = update.Check(e.e.StateDir, "0.1.0")
	st, _ := update.Check(e.e.StateDir, "0.2.0")
	e.e.UpdateGate = st
	e.e.StartUpdateGate(context.Background())
	if out, _ := e.call(t, "status", map[string]any{}); out == update.WaitingLine("0.2.0") {
		t.Fatalf("%q", out)
	}
}

func TestOlderBinaryCannotUnlockANewerPendingVersion(t *testing.T) {
	g := newGate(t)                                                // 0.1.0 approved, 0.2.0 pending, this process is 0.2.0
	if _, err := update.Check(g.e.StateDir, "0.1.0"); err != nil { // the AI starts the cached older binary
		t.Fatal(err)
	}
	if update.Pending(g.e.StateDir) == nil {
		t.Fatal("the older binary cleared the request for 0.2.0")
	}
	if out, _ := g.call(t, "status", map[string]any{}); out != update.WaitingLine("0.2.0") {
		t.Fatalf("0.2.0 unlocked by an older binary: %q", out)
	}
	g.answer(t, "approved")
	_, _ = g.call(t, "status", map[string]any{})
	g.settle(t, func() bool { s, _ := state.Read(g.e.StateDir); return s.ApprovedVersion == "0.2.0" })
	if out, _ := g.call(t, "status", map[string]any{}); out == update.WaitingLine("0.2.0") {
		t.Fatalf("still blocked after approval: %q", out)
	}
}

func TestBlockedEngineHandlesOnlyTheUpdateAnswer(t *testing.T) {
	g := newGate(t)
	connect, _ := json.Marshal(map[string]any{"v": 1, "type": "connect_github", "issued_at": ic.FormatTime(time.Now())})
	connectID, _ := ic.NewID(rand.Reader)
	sealedConnect, err := ic.SealAuth(ic.KindEngineInbox, g.e.Keys.KEMPub, g.acct, ic.AAD{UserID: gateUser, RootID: "", RecordID: connectID}, connect)
	if err != nil {
		t.Fatal(err)
	}
	s, _ := state.Read(g.e.StateDir)
	id := s.UpdatePending.ApprovalID
	pt, _ := json.Marshal(map[string]any{"v": 1, "type": "approval_result", "approval_id": id, "decision": "approved", "issued_at": ic.FormatTime(time.Now())})
	updID, _ := ic.NewID(rand.Reader)
	sealedUpd, _ := ic.SealAuth(ic.KindEngineInbox, g.e.Keys.KEMPub, g.acct, ic.AAD{UserID: gateUser, RootID: id, RecordID: updID}, pt)
	var deleted []string
	g.srv.Handle("DELETE", "/v1/inbox/:id", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		g.mu.Lock()
		deleted = append(deleted, r.URL.Path)
		g.mu.Unlock()
		testsrv.JSON(w, 200, map[string]any{})
	})
	g.mu.Lock()
	g.inbox = []map[string]string{{"msg_id": connectID, "sealed": ic.B64(sealedConnect)}, {"msg_id": updID, "sealed": ic.B64(sealedUpd)}}
	g.mu.Unlock()

	if n := g.e.inboxRound(context.Background()); n != 1 {
		t.Fatalf("events %d", n)
	}
	g.mu.Lock()
	got := append([]string(nil), deleted...)
	g.mu.Unlock()
	if len(got) != 1 || got[0] != "/v1/inbox/"+updID {
		t.Fatalf("deleted %v (the GitHub message must stay)", got)
	}
	if st, _ := state.Read(g.e.StateDir); st.ApprovedVersion != "0.2.0" {
		t.Fatalf("update not applied: %+v", st)
	}
	// unblocked now: the kept message is handled
	if n := g.e.inboxRound(context.Background()); n != 1 {
		t.Fatalf("the kept message was not handled later: %d", n)
	}
}

// Two unapproved versions open at once must not keep replacing each other's request (review M6-2).
func TestTwoUnapprovedVersionsDoNotPingPongRequests(t *testing.T) {
	g := newGate(t)                                                // 0.2.0 pending with one request sent
	if _, err := update.Check(g.e.StateDir, "0.3.0"); err != nil { // a 0.3.0 session starts
		t.Fatal(err)
	}
	g.mu.Lock()
	before := len(g.posts)
	g.mu.Unlock()
	for i := 0; i < 5; i++ {
		if out, _ := g.call(t, "status", map[string]any{}); out != update.WaitingLine("0.2.0") {
			t.Fatalf("0.2.0 not blocked: %q", out)
		}
	}
	g.e.Tick(context.Background())
	if p := update.Pending(g.e.StateDir); p == nil || p.Version != "0.3.0" {
		t.Fatalf("0.2.0 calls replaced the newer request: %+v", p)
	}
	g.mu.Lock()
	after := len(g.posts)
	g.mu.Unlock()
	if after != before {
		t.Fatalf("0.2.0 sent %d more requests", after-before)
	}
}
