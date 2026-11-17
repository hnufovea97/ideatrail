package mcpserver

import (
	"os"
	"path/filepath"
	"testing"

	"ideatrail/engine/internal/inbox"
)

// The signup list is the project first, then suggestions, and never more than RequestImport takes.
func TestSignupFoldersProjectFirstWithinTheRequestLimit(t *testing.T) {
	home, _ := filepath.EvalSymlinks(t.TempDir())
	parent := filepath.Join(home, "Projects")
	project := filepath.Join(parent, "ideatrail")
	for _, name := range []string{"ideatrail", "a", "b", "c", "d", "e", "f"} {
		dir := filepath.Join(parent, name)
		_ = os.MkdirAll(dir, 0o700)
		_ = os.WriteFile(filepath.Join(dir, "plan.md"), []byte("x"), 0o600)
	}
	stateDir := filepath.Join(home, "engine")
	got := signupFolders(project, stateDir, home)
	if len(got) != inbox.MaxFolders || got[0] != project {
		t.Fatalf("got %v", got)
	}
	if got := signupFolders("", stateDir, home); len(got) != 0 {
		t.Fatalf("no project: %v", got)
	}
}

// A project the guard refuses (here: the home folder) gets no suggestions either, so the browser
// never preselects a suggestion as if it were the current project.
func TestSignupFoldersNothingAroundARefusedProject(t *testing.T) {
	home, _ := filepath.EvalSymlinks(t.TempDir())
	t.Setenv("HOME", home) // the guard refuses the home folder itself as a project
	sibling := filepath.Join(filepath.Dir(home), "notes")
	_ = os.MkdirAll(sibling, 0o700)
	_ = os.WriteFile(filepath.Join(sibling, "a.md"), []byte("x"), 0o600)
	wider := filepath.Dir(filepath.Dir(home)) // so the sibling would otherwise count as a suggestion
	if got := signupFolders(home, filepath.Join(wider, "engine"), wider); got != nil {
		t.Fatalf("got %v", got)
	}
}
