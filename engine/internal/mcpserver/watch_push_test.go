package mcpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	ic "ideatrail/engine/internal/crypto"
	gh "ideatrail/engine/internal/github"
	"ideatrail/engine/internal/github/githubtest"
	"ideatrail/engine/internal/record"
	"ideatrail/engine/internal/repo"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/testsrv"
)

// G1: the select_folders answer started the first import and the watcher stopped at once; the
// records reached the API but their GitHub commits stayed queued until some later tool call. The
// watcher must run until the import is recorded, uploaded and pushed.
func TestWatcherPushesTheFirstImportBeforeItStops(t *testing.T) {
	e := newEnv(t, true)
	fake := githubtest.New(t)
	for _, h := range []struct{ method, path string }{{"PUT", "/v1/storage-link"}, {"POST", "/v1/repo-heads"}, {"POST", "/v1/anchors/:id/synced"}} {
		e.srv.Handle(h.method, h.path, func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
			testsrv.JSON(w, 200, map[string]any{})
		})
	}
	e.srv.Handle("GET", "/v1/import-allowance", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		testsrv.JSON(w, 200, map[string]any{"remaining": 200})
	})
	var posted atomic.Int32
	e.srv.Handle("POST", "/v1/records", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		posted.Add(1)
		testsrv.JSON(w, 201, map[string]any{})
	})
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/code") {
			_, _ = w.Write([]byte(`{"device_code":"dc","user_code":"ABCD-1234","expires_in":900,"interval":5}`))
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"ghu_test"}`))
	}))
	t.Cleanup(tokenSrv.Close)
	noSleep := func(context.Context, time.Duration) error { return nil }
	e.e.Repo.GitHubBase, e.e.Repo.Sleep = fake.URL, noSleep
	e.e.Repo.Flow = &gh.DeviceFlow{ClientID: "Iv1", CodeURL: tokenSrv.URL + "/code", TokenURL: tokenSrv.URL + "/token",
		Open: func(string) error { return nil }, ShowCode: func(string) error { return nil }, Sleep: noSleep}
	if err := repo.Connect(context.Background(), e.e.Repo); err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{"plan.md", "idea.md", "notes.md"} {
		_ = os.WriteFile(filepath.Join(e.folder, n), []byte("# "+n), 0o600)
	}
	const id = "01jcm3v8q7s2kx4f9d6b5n0tr0"
	_ = state.With(e.e.StateDir, func(s *state.State) error {
		s.Approvals = map[string]state.Approval{id: {Kind: "signup_select", CreatedAt: ic.FormatTime(time.Now())}}
		return nil
	})
	var answered atomic.Bool
	poll := func(ctx context.Context) int { // the select_folders answer, as inboxRound acts on it
		if answered.CompareAndSwap(false, true) {
			_ = state.With(e.e.StateDir, func(s *state.State) error { a := s.Approvals[id]; a.Done = true; s.Approvals[id] = a; return nil })
			if err := record.StartImport(e.e.Record, []string{e.folder}); err != nil {
				t.Error(err)
			}
			return 1
		}
		return e.e.pollOnce(ctx)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	watchSignup(ctx, fastTiming, poll, e.e.tickOnce, func() bool { return e.e.signupDone(id) })
	if ctx.Err() != nil {
		t.Fatal("the watcher did not stop once everything was pushed")
	}
	if posted.Load() == 0 || record.ImportPending(e.e.Record) {
		t.Fatalf("posted=%d import pending=%v", posted.Load(), record.ImportPending(e.e.Record))
	}
	if !repo.OutboxEmpty(e.e.Repo) {
		t.Fatal("the watcher stopped with GitHub commits still queued")
	}
	n := 0
	for p := range fake.Files("steven/ideatrail-proofs") {
		if strings.HasPrefix(p, "records/") {
			n++
		}
	}
	if n != int(posted.Load()) {
		t.Fatalf("records on GitHub %d, posted %d", n, posted.Load())
	}
}
