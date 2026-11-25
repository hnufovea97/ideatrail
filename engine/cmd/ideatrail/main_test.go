package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ideatrail/engine/internal/config"
	"ideatrail/engine/internal/hooks"
	"ideatrail/engine/internal/selfcheck"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/update"
)

func call(t *testing.T, stdin string, args ...string) (int, string, string) {
	t.Helper()
	var out, errb bytes.Buffer
	code := run(args, strings.NewReader(stdin), &out, &errb)
	return code, out.String(), errb.String()
}

func TestVersionAndUsage(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	if code, out, _ := call(t, "", "version"); code != 0 || !strings.HasPrefix(out, "ideatrail ") {
		t.Fatalf("version: %d %q", code, out)
	}
	if code, _, e := call(t, ""); code != 2 || !strings.Contains(e, "사용법") {
		t.Fatalf("usage: %d %q", code, e)
	}
}

func TestReleaseWithoutKeyRefusesToRun(t *testing.T) {
	if config.Dev() {
		t.Skip("dev build")
	}
	t.Setenv("HOME", t.TempDir())
	code, _, e := call(t, "", "mcp")
	if code != 1 || !strings.Contains(e, "정식으로 배포된") {
		t.Fatalf("got %d %q", code, e)
	}
}

func TestHookGuardExit2WithFixedMessage(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	paths, err := config.Locate()
	if err != nil {
		t.Fatal(err)
	}
	in, _ := json.Marshal(map[string]any{"tool_name": "Read", "tool_input": map[string]any{"file_path": filepath.Join(paths.Engine, "state.json")}, "cwd": h})
	code, out, e := call(t, string(in), "hook", "guard")
	if code != 2 || strings.TrimSpace(e) != hooks.GuardMessage || out != "" {
		t.Fatalf("got %d out=%q err=%q", code, out, e)
	}
	if code, _, _ := call(t, `{"tool_name":"Read","tool_input":{"file_path":"/tmp/x"}}`, "hook", "guard"); code != 0 {
		t.Fatal("normal read blocked")
	}
}

func TestHooksSilentOnBadInput(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	if code, _, e := call(t, "{{", "hook", "guard"); code != 2 || !strings.Contains(e, "열 수 없어요") {
		t.Errorf("guard must fail closed: %d %q", code, e)
	}
	for _, h := range []string{"session-start", "stop", "unknown"} {
		if code, out, e := call(t, "{{", "hook", h); code != 0 || out != "" || e != "" {
			t.Errorf("%s: %d %q %q", h, code, out, e)
		}
	}
}

func signedExe(t *testing.T, priv ed25519.PrivateKey, version string) string {
	t.Helper()
	exe := filepath.Join(t.TempDir(), "ideatrail")
	data := []byte("engine-" + version)
	_ = os.WriteFile(exe, data, 0o700)
	_ = os.WriteFile(exe+".sig", []byte(selfcheck.Sign(priv, "linux", "amd64", version, sha256.Sum256(data))), 0o600)
	return exe
}

func newKey(t *testing.T) (string, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	return base64.RawURLEncoding.EncodeToString(pub), priv
}

func TestFirstRunPinsKeyAndApprovesVersion(t *testing.T) {
	pub, priv := newKey(t)
	exe := signedExe(t, priv, "0.1.0")
	d := t.TempDir()
	if err := releaseCheck(pub, exe, "linux", "amd64", "0.1.0", d); err != nil {
		t.Fatal(err)
	}
	if err := update.Pin(d, pub); err != nil {
		t.Fatal(err)
	}
	st, err := update.Check(d, "0.1.0")
	s, _ := state.Read(d)
	if err != nil || st.Pending || s.ReleaseKey != pub || s.ApprovedVersion != "0.1.0" {
		t.Fatalf("%+v %v %+v", st, err, s)
	}
}

func TestNewVersionSignedWithAnotherKeyIsRefused(t *testing.T) {
	pub, _ := newKey(t)
	_, otherPriv := newKey(t)
	exe := signedExe(t, otherPriv, "0.2.0")
	if err := releaseCheck(pub, exe, "linux", "amd64", "0.2.0", t.TempDir()); !errors.Is(err, selfcheck.ErrBadSignature) {
		t.Fatalf("%v", err)
	}
}

func TestEmbeddedKeyDifferentFromPinnedIsRefused(t *testing.T) {
	pinned, _ := newKey(t)
	pub, priv := newKey(t) // a perfectly signed binary, but by a different key than the first install
	exe := signedExe(t, priv, "0.2.0")
	d := t.TempDir()
	if err := update.Pin(d, pinned); err != nil {
		t.Fatal(err)
	}
	if err := releaseCheck(pub, exe, "linux", "amd64", "0.2.0", d); !errors.Is(err, update.ErrKeyChanged) {
		t.Fatalf("%v", err)
	}
	if err := update.Pin(d, pub); !errors.Is(err, update.ErrKeyChanged) {
		t.Fatalf("pin accepted a changed key: %v", err)
	}
}

func TestReleaseCheckWithoutStateFolderStillVerifies(t *testing.T) {
	pub, priv := newKey(t)
	exe := signedExe(t, priv, "0.1.0")
	if err := releaseCheck(pub, exe, "linux", "amd64", "0.1.0", filepath.Join(t.TempDir(), "none")); err != nil {
		t.Fatal(err)
	}
}

func TestUnreadableStateIsNotReportedAsTampering(t *testing.T) {
	pub, priv := newKey(t)
	exe := signedExe(t, priv, "0.1.0")
	d := t.TempDir()
	if err := os.WriteFile(filepath.Join(d, "state.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := releaseCheck(pub, exe, "linux", "amd64", "0.1.0", d)
	if !errors.Is(err, errStateUnreadable) {
		t.Fatalf("%v", err)
	}
	if got := releaseMessage(err); got != msgStateBroken || got == msgTampered {
		t.Fatalf("%q", got)
	}
	if releaseMessage(selfcheck.ErrBadSignature) != msgTampered || releaseMessage(update.ErrKeyChanged) != msgKeyChanged {
		t.Fatal("other messages changed")
	}
}
