package hooks

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/update"
)

func fakeHome(t *testing.T) string {
	t.Helper()
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("USERPROFILE", h)
	return h
}

func guardJSON(t *testing.T, tool string, input map[string]any, cwd string) string {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"session_id": "s1", "tool_name": tool, "tool_input": input, "cwd": cwd})
	return string(b)
}

func TestGuardBlocksEngineFolderInAnySpelling(t *testing.T) {
	home := fakeHome(t)
	engine := filepath.Join(home, "Library", "Application Support", "IdeaTrail")
	protected := []string{engine, engine + "-outbox"}
	cases := []map[string]any{
		{"file_path": engine + "/engine.key"},
		{"file_path": "~/Library/Application Support/IdeaTrail/state.json"},
		{"command": `cat "$HOME/Library/Application Support/ideatrail/state.json"`},
		{"command": `cat ~/Library/Application\ Support/IDEATRAIL/github.json`},
		{"command": "cat ${HOME}/Library/Application Support/IdeaTrail-outbox/x.json"},
		{"file_path": "engine.key"},
		{"edits": []any{map[string]any{"file_path": engine + "/x"}}},
	}
	for i, in := range cases {
		if got := Guard(strings.NewReader(guardJSON(t, "Read", in, home)), protected); got != 2 {
			t.Errorf("case %d not blocked: %v", i, in)
		}
	}
	// relative path from inside Application Support
	rel := map[string]any{"file_path": "IdeaTrail/state.json"}
	if Guard(strings.NewReader(guardJSON(t, "Read", rel, filepath.Join(home, "Library", "Application Support"))), protected) != 2 {
		t.Error("relative path not blocked")
	}
}

func TestGuardAllowsNormalWorkAndDocumentText(t *testing.T) {
	home := fakeHome(t)
	engine := filepath.Join(home, "Library", "Application Support", "IdeaTrail")
	proj := filepath.Join(home, "Projects", "app")
	ok := []struct {
		tool string
		in   map[string]any
	}{
		{"Read", map[string]any{"file_path": proj + "/main.go"}},
		{"Write", map[string]any{"file_path": proj + "/notes.md", "content": "engine.key lives in Application Support/IdeaTrail"}},
		{"Edit", map[string]any{"file_path": proj + "/a.md", "old_string": "x", "new_string": "IdeaTrail-outbox"}},
		{"Grep", map[string]any{"pattern": "TODO"}},
		{"Bash", map[string]any{"command": "go test ./..."}},
		{"Bash", map[string]any{"command": "ls *.go && rm -f tmp/*.log"}},
		{"Glob", map[string]any{"pattern": "src/**/*.ts"}},
	}
	for i, c := range ok {
		if got := Guard(strings.NewReader(guardJSON(t, c.tool, c.in, proj)), []string{engine}); got != 0 {
			t.Errorf("case %d wrongly blocked", i)
		}
	}
}

func TestGuardBlocksSearchSweepingEngineFolder(t *testing.T) {
	home := fakeHome(t)
	engine := filepath.Join(home, "Library", "Application Support", "IdeaTrail")
	if Guard(strings.NewReader(guardJSON(t, "Grep", map[string]any{"pattern": "token", "path": home + "/Library"}, home)), []string{engine}) != 2 {
		t.Error("grep over Library not blocked")
	}
	if Guard(strings.NewReader(guardJSON(t, "Glob", map[string]any{"pattern": "**/*.json"}, home)), []string{engine}) != 2 {
		t.Error("glob from home not blocked")
	}
}

func TestGuardFailsClosedOnUnreadableInput(t *testing.T) {
	fakeHome(t)
	if Guard(strings.NewReader("not json"), []string{"/x"}) != 2 {
		t.Error("garbage must be blocked")
	}
	big := `{"tool_name":"Bash","tool_input":{"command":"` + strings.Repeat("a", maxGuardInput) + `"}}`
	if Guard(strings.NewReader(big), []string{"/x"}) != 2 {
		t.Error("oversized input must be blocked")
	}
}

func TestGuardBlocksIndirectRoutes(t *testing.T) {
	home := fakeHome(t)
	engine := filepath.Join(home, "Library", "Application Support", "IdeaTrail")
	protected := []string{engine, engine + "-outbox", filepath.Join(home, "ideatrail-증명")}
	for i, cmd := range []string{
		`cd ~/Library/Application\ Support && cat ideatrail/ideatrail-github.json`,
		`cat ~/Library/App*/idea*/*.json`,
		`cd ~/Library && ls -R`,
		`cd ~ && cd Library`,
		`grep -r token $HOME`,
		`find ~ -name "*.json"`,
		`cat idea*/ideatrail-github.json`,
		`ls ~/ideatrail-증명`,
		`cat %LOCALAPPDATA%\\IdeaTrail\\state.json`,
	} {
		if Guard(strings.NewReader(guardJSON(t, "Bash", map[string]any{"command": cmd}, home+"/Projects/app")), protected) != 2 {
			t.Errorf("case %d not blocked: %s", i, cmd)
		}
	}
}

func setup(t *testing.T) (stateDir, folder string) {
	t.Helper()
	fakeHome(t)
	stateDir = t.TempDir()
	f, _ := filepath.EvalSymlinks(t.TempDir())
	if err := state.With(stateDir, func(s *state.State) error {
		s.UserID, s.AccountPub = "u1", "pub"
		s.Folders = map[string]string{f: "r1"}
		s.Roots = map[string]state.Root{"r1": {}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return stateDir, f
}

func hookJSON(session, cwd string, active bool) string {
	b, _ := json.Marshal(map[string]any{"session_id": session, "cwd": cwd, "stop_hook_active": active})
	return string(b)
}

func TestStopAsksOnceWhenChangesExist(t *testing.T) {
	stateDir, folder := setup(t)
	SessionStart(strings.NewReader(hookJSON("abc", folder, false)), stateDir)
	// backdate the session start so the new file counts
	_ = os.WriteFile(filepath.Join(stateDir, "sessions", "abc.start"), []byte("1"), 0o600)
	_ = os.WriteFile(filepath.Join(folder, "idea.md"), []byte("x"), 0o600)
	_ = os.MkdirAll(filepath.Join(folder, ".git"), 0o700)
	_ = os.WriteFile(filepath.Join(folder, ".git", "HEAD"), []byte("x"), 0o600)

	out := Stop(strings.NewReader(hookJSON("abc", folder, false)), stateDir)
	var m map[string]string
	if err := json.Unmarshal([]byte(out), &m); err != nil || m["decision"] != "block" || !strings.Contains(m["reason"], "1건") {
		t.Fatalf("want block with 1건, got %q", out)
	}
	if again := Stop(strings.NewReader(hookJSON("abc", folder, false)), stateDir); again != "" {
		t.Fatalf("asked twice: %q", again)
	}
}

func TestStopSilentCases(t *testing.T) {
	stateDir, folder := setup(t)
	_ = os.WriteFile(filepath.Join(folder, "idea.md"), []byte("x"), 0o600)
	// no baseline
	if Stop(strings.NewReader(hookJSON("nobase", folder, false)), stateDir) != "" {
		t.Error("spoke without baseline")
	}
	SessionStart(strings.NewReader(hookJSON("s2", folder, false)), stateDir)
	_ = os.WriteFile(filepath.Join(stateDir, "sessions", "s2.start"), []byte("1"), 0o600)
	// stop_hook_active
	if Stop(strings.NewReader(hookJSON("s2", folder, true)), stateDir) != "" {
		t.Error("spoke while stop_hook_active")
	}
	// bad session id (path traversal)
	if Stop(strings.NewReader(hookJSON("../../x", folder, false)), stateDir) != "" {
		t.Error("accepted bad session id")
	}
	// unregistered folder
	other, _ := filepath.EvalSymlinks(t.TempDir())
	SessionStart(strings.NewReader(hookJSON("s3", other, false)), stateDir)
	if Stop(strings.NewReader(hookJSON("s3", other, false)), stateDir) != "" {
		t.Error("spoke for unregistered folder")
	}
	// recorded after the change
	SessionStart(strings.NewReader(hookJSON("s4", folder, false)), stateDir)
	_ = os.WriteFile(filepath.Join(stateDir, "sessions", "s4.start"), []byte("1"), 0o600)
	_ = state.With(stateDir, func(s *state.State) error {
		r := s.Roots["r1"]
		r.LastRecordAt = time.Now().Add(time.Minute).UTC().Format(time.RFC3339)
		s.Roots["r1"] = r
		return nil
	})
	if Stop(strings.NewReader(hookJSON("s4", folder, false)), stateDir) != "" {
		t.Error("spoke although everything was recorded")
	}
}

func TestSessionStartLines(t *testing.T) {
	fakeHome(t)
	dir := t.TempDir()
	if got := SessionStart(strings.NewReader(hookJSON("a", "/", false)), dir); !strings.Contains(got, "가입 전") || !strings.Contains(got, "브라우저") || !strings.Contains(got, "약 5분") {
		t.Errorf("unregistered line: %q", got)
	}
	stateDir, folder := setup(t)
	if got := SessionStart(strings.NewReader(hookJSON("b", folder, false)), stateDir); got != "" {
		t.Errorf("registered should be silent: %q", got)
	}
}

// Hook lines reach the person through the AI: plain words, no engine jargon (G1 feedback).
func TestHookSentencesUsePlainWords(t *testing.T) {
	for _, s := range []string{GuardMessage, msgBeforeSignup, msgBlocked, stopReason(3)} {
		if strings.Contains(s, "엔진") || strings.Contains(s, "\n") {
			t.Errorf("not plain: %q", s)
		}
	}
	if !strings.Contains(stopReason(3), "3건") {
		t.Errorf("stop reason %q", stopReason(3))
	}
}

func TestSessionStartSaysWhenANewVersionWaits(t *testing.T) {
	stateDir, folder := setup(t)
	_ = state.With(stateDir, func(s *state.State) error {
		s.UpdatePending = &state.UpdatePending{Version: "0.2.0"}
		return nil
	})
	if got := SessionStart(strings.NewReader(hookJSON("u1", folder, false)), stateDir); got != update.WaitingLine("0.2.0") {
		t.Fatalf("%q", got)
	}
	_ = state.With(stateDir, func(s *state.State) error { s.UpdatePending.Rejected = true; return nil })
	if got := SessionStart(strings.NewReader(hookJSON("u2", folder, false)), stateDir); got != update.RejectedLine {
		t.Fatalf("%q", got)
	}
}
