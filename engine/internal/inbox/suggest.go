package inbox

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ideatrail/engine/internal/pathguard"
)

// SuggestFolders offers up to max sibling folders of project that look like ideas (signup step 5):
// visible, not node_modules, with a Markdown file directly inside, allowed by pathguard, newest
// first. Only when the project's parent lies strictly inside home (never home's own children).
// Names and counts leave the machine only sealed to the account key (kind 11).
func SuggestFolders(project, stateDir, home string, max int) []string {
	parent := filepath.Dir(project)
	if max <= 0 || !strictlyInside(home, parent) {
		return nil
	}
	entries, err := os.ReadDir(parent)
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
		if !e.IsDir() || strings.HasPrefix(name, ".") || name == "node_modules" || filepath.Clean(p) == filepath.Clean(project) {
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
