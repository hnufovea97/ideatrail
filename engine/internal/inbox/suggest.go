package inbox

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ideatrail/engine/internal/pathguard"
)

// maxSiblingsExamined caps the parent's entries looked at, so a huge folder cannot hold signup.
var maxSiblingsExamined = 1000

// SuggestFolders offers up to max sibling folders of project that look like ideas (signup step 5):
// visible, not node_modules, with a Markdown file directly inside, allowed by pathguard, newest
// first. Only when the project's parent lies strictly inside home (never home's own children),
// both resolved through links first.
// Names and counts leave the machine only sealed to the account key (kind 11).
func SuggestFolders(project, stateDir, home string, max int) []string {
	if max <= 0 || project == "" || home == "" {
		return nil
	}
	realProject, err := filepath.EvalSymlinks(project)
	if err != nil {
		return nil
	}
	realHome, err := filepath.EvalSymlinks(home)
	if err != nil {
		return nil
	}
	parent := filepath.Dir(realProject)
	if !strictlyInside(realHome, parent) {
		return nil
	}
	entries, err := readDirCapped(parent, maxSiblingsExamined)
	if err != nil {
		return nil
	}
	type candidate struct {
		path string
		mod  int64
	}
	var found []candidate
	for _, e := range entries {
		name := e.Name()
		p := filepath.Join(parent, name)
		if !e.IsDir() || strings.HasPrefix(name, ".") || name == "node_modules" || p == realProject {
			continue
		}
		if !hasMarkdown(p) || pathguard.ValidateFolder(p, stateDir) != nil {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		found = append(found, candidate{p, info.ModTime().UnixNano()})
	}
	sort.Slice(found, func(i, j int) bool { return found[i].mod > found[j].mod })
	if len(found) > max {
		found = found[:max]
	}
	out := make([]string, len(found))
	for i, c := range found {
		out[i] = c.path
	}
	return out
}

// readDirCapped reads at most n entries of dir, in no particular order.
func readDirCapped(dir string, n int) ([]os.DirEntry, error) {
	f, err := os.Open(dir)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	entries, err := f.ReadDir(n)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return entries, nil
}

func hasMarkdown(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.Type().IsRegular() && strings.EqualFold(filepath.Ext(e.Name()), ".md") {
			return true
		}
	}
	return false
}

// strictlyInside reports whether dir is below home (and is not home itself).
func strictlyInside(home, dir string) bool {
	if home == "" {
		return false
	}
	rel, err := filepath.Rel(filepath.Clean(home), filepath.Clean(dir))
	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
