package main

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"ideatrail/engine/internal/config"
	"ideatrail/engine/internal/hooks"
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
