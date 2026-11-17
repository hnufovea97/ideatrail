package inbox

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func tree(t *testing.T) (home, parent string) {
	t.Helper()
	home, _ = filepath.EvalSymlinks(t.TempDir())
	return home, filepath.Join(home, "Projects")
}

func mkdir(t *testing.T, dir string, files ...string) string {
	t.Helper()
	_ = os.MkdirAll(dir, 0o700)
	for _, f := range files {
		_ = os.WriteFile(filepath.Join(dir, f), []byte("x"), 0o600)
	}
	return dir
}

func TestSuggestFoldersPicksIdeaLookingSiblings(t *testing.T) {
	home, parent := tree(t)
	project := mkdir(t, filepath.Join(parent, "ideatrail"), "README.md")
	older := mkdir(t, filepath.Join(parent, "가계부 앱"), "plan.md")
	newer := mkdir(t, filepath.Join(parent, "notes"), "a.MD")
	mkdir(t, filepath.Join(parent, ".hidden"), "x.md")
	mkdir(t, filepath.Join(parent, "node_modules"), "x.md")
	mkdir(t, filepath.Join(parent, "code"), "main.go")
	mkdir(t, filepath.Join(parent, "empty"))
	past := time.Now().Add(-time.Hour)
	_ = os.Chtimes(older, past, past)
	engineDir := mkdir(t, filepath.Join(home, "engine"))

	if got, want := SuggestFolders(project, engineDir, home, 4), []string{newer, older}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if got := SuggestFolders(project, engineDir, home, 1); len(got) != 1 {
		t.Fatalf("max not applied: %v", got)
	}
}

// A project directly in the home folder would make Documents, Desktop… "siblings": offer nothing.
func TestSuggestFoldersNothingWhenProjectSitsInHome(t *testing.T) {
	home, _ := tree(t)
	project := mkdir(t, filepath.Join(home, "p"), "a.md")
	mkdir(t, filepath.Join(home, "Documents"), "b.md")
	if got := SuggestFolders(project, filepath.Join(home, "engine"), home, 4); len(got) != 0 {
		t.Fatalf("got %v, want none", got)
	}
}
