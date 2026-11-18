package mcpserver

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/record"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/testsrv"
)

var fastTiming = signupTiming{poll: 2 * time.Millisecond, full: 20 * time.Millisecond, total: time.Minute, pairPoll: 5 * time.Millisecond, retry: time.Millisecond}

// The watcher reads only the inbox at the fast cadence, runs the full round on the slow one (or
// right after an event), and stops once the signup is done.
func TestWatchSignupPollsFastFullSlowAndStopsWhenDone(t *testing.T) {
	var polls, fulls atomic.Int32
	finished := make(chan struct{})
	go func() {
		watchSignup(context.Background(), fastTiming,
			func(context.Context) int { polls.Add(1); return 0 },
			func(context.Context) { fulls.Add(1) },
			func() bool { return polls.Load() >= 40 })
		close(finished)
	}()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("watcher did not stop when the signup was done")
	}
	if fulls.Load() >= polls.Load()/2 {
		t.Fatalf("full rounds %d vs inbox polls %d: full round is not on the slow cadence", fulls.Load(), polls.Load())
	}
}

func TestWatchSignupRunsTheFullRoundAfterAnEvent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	slow := fastTiming
	slow.full = time.Hour
	var fulls atomic.Int32
	finished := make(chan struct{})
	go func() {
		watchSignup(ctx, slow, func(context.Context) int { return 1 }, func(context.Context) { fulls.Add(1) }, func() bool { return fulls.Load() >= 2 })
		close(finished)
	}()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("an inbox event did not trigger the full round")
	}
}

func TestWatchSignupStopsWhenCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan struct{})
	go func() {
		watchSignup(ctx, fastTiming, func(context.Context) int { return 0 }, func(context.Context) {}, func() bool { return false })
		close(finished)
	}()
	cancel()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("watchSignup did not stop when cancelled")
	}
}

// While another background round holds the lock, a signup round must not start a second one.
func TestTickOnceSkipsWhileBackgroundRuns(t *testing.T) {
	e := &Engine{}
	e.bg.Lock()
	defer e.bg.Unlock()
	e.tickOnce(context.Background()) // a zero Engine would panic inside Tick; returning early is the point
	if e.pollOnce(context.Background()) != 0 {
		t.Fatal("poll ran under the background lock")
	}
}

func TestGoSafeRefusesWorkOnceClosing(t *testing.T) {
	e := &Engine{}
	e.Close(time.Second)
	var ran atomic.Bool
	if e.goSafe(func() { ran.Store(true) }) {
		t.Fatal("goSafe accepted work after Close")
	}
	time.Sleep(10 * time.Millisecond)
	if ran.Load() {
		t.Fatal("work ran after Close")
	}
}

// A recovered panic leaves one fixed journal line: never the panic value, which could carry a secret.
func TestGoSafePanicJournalsAFixedLine(t *testing.T) {
	dir := t.TempDir()
	e := &Engine{StateDir: dir}
	e.goSafe(func() { panic("token sk-live-123 at /Users/x/secret") })
	e.Close(5 * time.Second)
	b, _ := os.ReadFile(filepath.Join(dir, "journal.log"))
	if !strings.Contains(string(b), `"status":"panic_recovered"`) || strings.Contains(string(b), "sk-live") || strings.Contains(string(b), "/Users") {
		t.Fatalf("journal %q", b)
	}
}

// RequestImport failing (here: not paired) is retried a few times, then journaled.
func TestSignupListRetriedThenJournaled(t *testing.T) {
	e := newEnv(t, false)
	e.e.timing = fastTiming
	if id := e.e.postSignupList(context.Background()); id != "" {
		t.Fatalf("id %q", id)
	}
	b, _ := os.ReadFile(filepath.Join(e.e.StateDir, "journal.log"))
	if strings.Count(string(b), `"status":"signup_list_failed"`) != 1 {
		t.Fatalf("journal %q", b)
	}
}

// signupDone: the signup list was answered and no GitHub login is running.
func TestSignupDoneNeedsAnAnsweredListAndNoGitHubLogin(t *testing.T) {
	e := newEnv(t, true)
	const id = "01jcm3v8q7s2kx4f9d6b5n0tr0"
	_ = state.With(e.e.StateDir, func(s *state.State) error {
		s.Approvals = map[string]state.Approval{id: {Kind: "signup_select", CreatedAt: ic.FormatTime(time.Now())}}
		return nil
	})
	if e.e.signupDone(id) || e.e.signupDone("") {
		t.Fatal("done before the list was answered")
	}
	_ = state.With(e.e.StateDir, func(s *state.State) error { a := s.Approvals[id]; a.Done = true; s.Approvals[id] = a; return nil })
	e.e.connecting.Store(true)
	if e.e.signupDone(id) {
		t.Fatal("done while a GitHub login runs")
	}
	e.e.connecting.Store(false)
	if !e.e.signupDone(id) {
		t.Fatal("not done after the answer")
	}
}

// A first import left in state (engine closed mid-import) is resumed by the next round.
func TestTickResumesAPendingImport(t *testing.T) {
	e := newEnv(t, true)
	srv := e.srv
	srv.Handle("GET", "/v1/import-allowance", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		testsrv.JSON(w, 200, map[string]any{"remaining": 200})
	})
	var posted atomic.Int32
	srv.Handle("POST", "/v1/records", func(w http.ResponseWriter, r *http.Request, b []byte, _ string) {
		posted.Add(1)
		testsrv.JSON(w, 201, map[string]any{})
	})
	_ = os.WriteFile(filepath.Join(e.folder, "plan.md"), []byte("x"), 0o600)
	if err := record.StartImport(e.e.Record, []string{e.folder}); err != nil {
		t.Fatal(err)
	}
	e.e.Tick(context.Background())
	deadline := time.Now().Add(10 * time.Second)
	for record.ImportPending(e.e.Record) && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	e.e.Close(10 * time.Second)
	if posted.Load() != 1 || record.ImportPending(e.e.Record) {
		t.Fatalf("posted=%d pending=%v", posted.Load(), record.ImportPending(e.e.Record))
	}
}

// L4: pairing finishes → the signup list is posted (home from Engine.Home, never the real one) →
// the watcher runs until Close, and Close leaves no goroutine behind.
func TestPairingPostsTheSignupListAndTheWatcherStopsOnClose(t *testing.T) {
	e := newEnv(t, false)
	e.e.timing = fastTiming
	home := filepath.Dir(filepath.Dir(e.folder))
	e.e.Home = func() (string, error) { return home, nil }
	var mu sync.Mutex
	var blob map[string]string
	var kinds []string
	var inboxReads atomic.Int32
	e.srv.Handle("GET", "/v1/pairing/:id/blob", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		mu.Lock()
		defer mu.Unlock()
		if blob == nil {
			testsrv.Fail(w, 404, "not_ready")
			return
		}
		testsrv.JSON(w, 200, blob)
	})
	e.srv.Handle("POST", "/v1/approvals", func(w http.ResponseWriter, r *http.Request, b []byte, _ string) {
		var body map[string]any
		_ = json.Unmarshal(b, &body)
		mu.Lock()
		kinds = append(kinds, body["kind"].(string))
		mu.Unlock()
		testsrv.JSON(w, 201, map[string]any{})
	})
	e.srv.Handle("GET", "/v1/inbox", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		inboxReads.Add(1)
		testsrv.JSON(w, 200, map[string]any{"messages": []any{}})
	})
	if out, _ := e.call(t, "status", map[string]any{}); out != msgPairingOpened {
		t.Fatalf("%q", out)
	}
	mu.Lock()
	blob = deliverBlob(t, e)
	mu.Unlock()
	deadline := time.Now().Add(10 * time.Second)
	for {
		mu.Lock()
		n := len(kinds)
		mu.Unlock()
		if n > 0 && inboxReads.Load() >= 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("signup list posted=%d inbox reads=%d", n, inboxReads.Load())
		}
		time.Sleep(5 * time.Millisecond)
	}
	mu.Lock()
	if kinds[0] != "signup_select" {
		t.Fatalf("kinds %v", kinds)
	}
	mu.Unlock()
	start := time.Now()
	e.e.Close(5 * time.Second)
	if time.Since(start) > 2*time.Second {
		t.Fatal("the watcher did not stop on Close")
	}
	reads := inboxReads.Load()
	time.Sleep(30 * time.Millisecond)
	if inboxReads.Load() != reads {
		t.Fatal("the watcher kept reading the inbox after Close")
	}
}

// deliverBlob plays the browser's pairing handoff for the link the engine opened.
func deliverBlob(t *testing.T, e *env) map[string]string {
	t.Helper()
	link := e.opened[0]
	parts := strings.Split(link[strings.Index(link, "#")+1:], ".")
	psk, _ := ic.UnB64(parts[3])
	const userID, sessionID = "01jcm3v8q7s2kx4f9d6b5n0tqx", "01jcm3v8q7s2kx4f9d6b5n0tqw"
	pt, _ := json.Marshal(map[string]string{"user_id": userID, "account_pubkey": ic.B64(e.akPub)})
	payload, err := ic.Seal(ic.KindPairingPayload, e.e.Keys.KEMPub, ic.AAD{UserID: userID}, pt)
	if err != nil {
		t.Fatal(err)
	}
	m := hmac.New(sha256.New, psk)
	m.Write([]byte("ideatrail/v1/pair"))
	m.Write([]byte(sessionID))
	m.Write(payload)
	return map[string]string{"user_id": userID, "payload": ic.B64(payload), "mac": hex.EncodeToString(m.Sum(nil))}
}
