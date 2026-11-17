package github

import (
	"context"

	"errors"
	"ideatrail/engine/internal/github/githubtest"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func noSleep(context.Context, time.Duration) error { return nil }

func TestEnsureRepoCreatesPrivateWithReadme(t *testing.T) {
	f := githubtest.New(t)
	c := NewClient(f.URL, "ghu_token")
	r, err := EnsureRepo(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	if r.FullName != "steven/ideatrail-proofs" || !f.Repos[r.FullName]["private"].(bool) {
		t.Fatalf("%+v", r)
	}
	if !strings.Contains(f.Files(r.FullName)["README.md"], "Ideatrail") {
		t.Fatal("README missing")
	}
}

func TestEnsureRepoNeverUsesPublicOrForeignRepo(t *testing.T) {
	f := githubtest.New(t)
	f.AddRepo("ideatrail-proofs", false, "steven") // public!
	r, err := EnsureRepo(context.Background(), NewClient(f.URL, "t"))
	if err != nil || r.FullName != "steven/ideatrail-proofs-2" {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestEnsureRepoNotInstalledAndNoBodyInErrors(t *testing.T) {
	f := githubtest.New(t)
	f.CreateErr = 403
	_, err := EnsureRepo(context.Background(), NewClient(f.URL, "t"))
	if !errors.Is(err, ErrNotInstalled) || strings.Contains(err.Error(), "SECRET-BODY") {
		t.Fatalf("got %v", err)
	}
}

func TestCommitFilesAndSkipDuplicates(t *testing.T) {
	f := githubtest.New(t)
	c := NewClient(f.URL, "t")
	r, _ := EnsureRepo(context.Background(), c)
	files := map[string][]byte{"records/a.it1": []byte("sealed"), "proofs/a/bundle.json": []byte("{}")}
	if _, err := CommitFiles(context.Background(), c, r, files, "ideatrail: record a", "records/a.it1", noSleep); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitFiles(context.Background(), c, r, files, "ideatrail: record a", "records/a.it1", noSleep); err != nil {
		t.Fatal(err)
	}
	if n := f.CommitCount(r.FullName); n != 2 { // README + one record commit, not two
		t.Fatalf("commits %d", n)
	}
}

func TestConcurrentPushRetriesWithoutForce(t *testing.T) {
	f := githubtest.New(t)
	c := NewClient(f.URL, "t")
	r, _ := EnsureRepo(context.Background(), c)
	f.BeforePatch = func() { f.PushDirect(r.FullName, map[string][]byte{"records/other.it1": []byte("x")}) }
	if _, err := CommitFiles(context.Background(), c, r, map[string][]byte{"records/mine.it1": []byte("y")}, "m", "records/mine.it1", noSleep); err != nil {
		t.Fatal(err)
	}
	got := f.Files(r.FullName)
	if got["records/other.it1"] != "x" || got["records/mine.it1"] != "y" {
		t.Fatalf("lost a commit: %v", got)
	}
}

func TestRateLimitWaitsThenSucceeds(t *testing.T) {
	f := githubtest.New(t)
	c := NewClient(f.URL, "t")
	r, _ := EnsureRepo(context.Background(), c)
	f.RateLimitLeft = 1
	waited := time.Duration(0)
	sleep := func(_ context.Context, d time.Duration) error { waited += d; return nil }
	if _, err := CommitFiles(context.Background(), c, r, map[string][]byte{"a": []byte("b")}, "m", "", sleep); err != nil {
		t.Fatal(err)
	}
	if waited != time.Second {
		t.Fatalf("waited %v", waited)
	}
}

func TestDeviceFlowOpensFixedURLAndRefusesExpiringTokens(t *testing.T) {
	polls := 0
	expiring := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/code") {
			_, _ = w.Write([]byte(`{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://evil.example/login","expires_in":900,"interval":5}`))
			return
		}
		polls++
		switch {
		case polls == 1:
			_, _ = w.Write([]byte(`{"error":"authorization_pending"}`))
		case polls == 2:
			_, _ = w.Write([]byte(`{"error":"slow_down"}`))
		case expiring:
			_, _ = w.Write([]byte(`{"access_token":"ghu_x","expires_in":28800,"refresh_token":"ghr_y"}`))
		default:
			_, _ = w.Write([]byte(`{"access_token":"ghu_good"}`))
		}
	}))
	defer srv.Close()
	var opened, shown string
	flow := &DeviceFlow{ClientID: "Iv1", CodeURL: srv.URL + "/login/device/code", TokenURL: srv.URL + "/token",
		Open: func(l string) error { opened = l; return nil }, ShowCode: func(c string) error { shown = c; return nil }, Sleep: noSleep}
	tok, err := flow.Login(context.Background())
	if err != nil || tok != "ghu_good" || opened != VerificationURL || shown != "ABCD-1234" {
		t.Fatalf("tok=%q err=%v opened=%q shown=%q", tok, err, opened, shown)
	}
	polls, expiring = 2, true
	if _, err := flow.Login(context.Background()); !errors.Is(err, ErrTokenExpires) {
		t.Fatalf("expiring token accepted: %v", err)
	}
}

func TestDeviceFlowDenied(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/code") {
			_, _ = w.Write([]byte(`{"device_code":"dc","user_code":"ABCD-1234","expires_in":900,"interval":5}`))
			return
		}
		_, _ = w.Write([]byte(`{"error":"access_denied"}`))
	}))
	defer srv.Close()
	flow := &DeviceFlow{ClientID: "Iv1", CodeURL: srv.URL + "/code", TokenURL: srv.URL + "/token",
		Open: func(string) error { return nil }, ShowCode: func(string) error { return nil }, Sleep: noSleep}
	if _, err := flow.Login(context.Background()); !errors.Is(err, ErrDenied) {
		t.Fatalf("got %v", err)
	}
}
