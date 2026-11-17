package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/testsrv"
)

func setup(t *testing.T) (*Client, *testsrv.Server, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "engine")
	_ = os.Mkdir(dir, 0o700)
	k, err := keys.LoadOrCreate(dir)
	if err != nil {
		t.Fatal(err)
	}
	srv := testsrv.New()
	t.Cleanup(srv.Close)
	srv.AddEngine(k.EngineID, k.SignPub())
	srv.Handle("POST", "/v1/echo", func(w http.ResponseWriter, r *http.Request, body []byte, id string) {
		testsrv.JSON(w, 200, map[string]any{"engine": id, "len": len(body)})
	})
	srv.Handle("GET", "/v1/list", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		testsrv.JSON(w, 200, map[string]string{"q": r.URL.RawQuery})
	})
	c, err := New(srv.URL, k, dir)
	if err != nil {
		t.Fatal(err)
	}
	c.sleep = func(time.Duration) {}
	return c, srv, dir
}

func TestSignedRequestAccepted(t *testing.T) {
	c, _, _ := setup(t)
	var out struct {
		Engine string `json:"engine"`
		Len    int    `json:"len"`
	}
	if err := c.Do(context.Background(), "POST", "/v1/echo", map[string]int{"a": 1}, &out); err != nil {
		t.Fatal(err)
	}
	if out.Engine != c.keys.EngineID || out.Len == 0 {
		t.Fatalf("%+v", out)
	}
	var q struct{ Q string }
	if err := c.Do(context.Background(), "GET", "/v1/list?since=5", nil, &q); err != nil || q.Q != "since=5" {
		t.Fatalf("%v %+v", err, q)
	}
}

func TestSeqIncreasesAndRetriesUseNewSeq(t *testing.T) {
	c, srv, dir := setup(t)
	srv.FailNext(2, 503)
	if err := c.Do(context.Background(), "POST", "/v1/echo", nil, nil); err != nil {
		t.Fatal(err)
	}
	seqs := srv.Seqs()
	if len(seqs) != 3 || seqs[0] != 1 || seqs[2] != 3 {
		t.Fatalf("seqs %v", seqs)
	}
	s, _ := state.Read(dir)
	if s.ReqSeq != 3 {
		t.Fatalf("state seq %d", s.ReqSeq)
	}
}

func TestClientErrorReturnedImmediatelyWithoutServerMessage(t *testing.T) {
	c, srv, _ := setup(t)
	srv.FailNext(1, 409)
	err := c.Do(context.Background(), "POST", "/v1/echo", nil, nil)
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Status != 409 || apiErr.Code != "injected" {
		t.Fatalf("got %v", err)
	}
	if strings.Contains(err.Error(), "IGNORE") {
		t.Fatal("server message leaked into error")
	}
	if len(srv.Seqs()) != 1 {
		t.Fatal("4xx must not be retried")
	}
}

func TestLostResponseDoesNotReuseSeq(t *testing.T) {
	c, srv, _ := setup(t)
	// A response lost after the server accepted seq 1: next call must use seq 2, not 1.
	_ = c.Do(context.Background(), "POST", "/v1/echo", nil, nil)
	if err := c.Do(context.Background(), "POST", "/v1/echo", nil, nil); err != nil {
		t.Fatal(err)
	}
	if got := srv.Seqs(); len(got) != 2 || got[1] != 2 {
		t.Fatalf("seqs %v", got)
	}
}

func TestConcurrentCallersNeverShareSeq(t *testing.T) {
	c, srv, _ := setup(t)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := c.Do(context.Background(), "POST", "/v1/echo", nil, nil); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if n := len(srv.Seqs()); n != 20 {
		t.Fatalf("accepted %d", n)
	}
}

func TestRefusesLargeBodiesAndPlainHTTP(t *testing.T) {
	c, srv, _ := setup(t)
	if err := c.Do(context.Background(), "POST", "/v1/echo", strings.Repeat("x", MaxRequestBody), nil); !errors.Is(err, ErrRequestTooLarge) {
		t.Fatalf("got %v", err)
	}
	if len(srv.Seqs()) != 0 {
		t.Fatal("oversized request was sent")
	}
	if _, err := New("http://api.example.com", c.keys, c.stateDir); err == nil {
		t.Fatal("plain http accepted")
	}
}

func TestDoesNotFollowRedirects(t *testing.T) {
	c, srv, _ := setup(t)
	srv.Handle("GET", "/v1/redir", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		http.Redirect(w, r, "https://evil.example/", http.StatusFound)
	})
	err := c.Do(context.Background(), "GET", "/v1/redir", nil, nil)
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Status != 302 {
		t.Fatalf("got %v", err)
	}
}
