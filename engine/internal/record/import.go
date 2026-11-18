package record

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ideatrail/engine/internal/pathguard"
	"ideatrail/engine/internal/state"
)

// ImportLimit is the signup first-import cap in files (UX "1회 200개", plan decision D1).
const ImportLimit = 200

const importNote = "가입 때 가져온 문서"

// ImportFolders records the existing files of folders newly registered at signup: at most limit
// files in all, MaxFiles per record, each record marked as the signup import, and never more
// records than the server's import allowance has left. Files the path guard refuses are left out
// up front; files beyond the limit are left for ordinary recording when they change. Returns how
// many files were recorded. No folders means no work and no network call.
func ImportFolders(ctx context.Context, d Deps, folders []string, limit int) (int, error) {
	if len(folders) == 0 || limit <= 0 {
		return 0, nil
	}
	records, err := importAllowance(ctx, d)
	if err != nil {
		return 0, err
	}
	st, err := state.Read(d.StateDir)
	if err != nil {
		return 0, err
	}
	g := d.guard(st)
	done := 0
	for _, f := range folders {
		files := importable(g, f, st.Folders[f])
		for len(files) > 0 && done < limit && records > 0 {
			n := min(len(files), MaxFiles, limit-done)
			if _, err := Record(ctx, d, Input{Paths: files[:n], Note: importNote, Import: true}); err != nil {
				return done, err
			}
			done += n
			records--
			files = files[n:]
		}
	}
	return done, nil
}

// importAllowance asks the server how many import records are left (it creates the signup
// allowance on the first ask, spec M2b).
func importAllowance(ctx context.Context, d Deps) (int, error) {
	var out struct {
		Remaining int `json:"remaining"`
	}
	if err := d.API.Do(ctx, "GET", "/v1/import-allowance", nil, &out); err != nil {
		return 0, err
	}
	return out.Remaining, nil
}

// importable lists, in path order, the regular files under folder that the guard lets this
// folder's record read: hidden entries and node_modules are skipped, and so are files of another
// registered folder nested inside (they belong to that idea).
func importable(g *pathguard.Guard, folder, rootID string) []string {
	if rootID == "" {
		return nil
	}
	var out []string
	_ = filepath.WalkDir(folder, func(p string, e os.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable entries are skipped, the rest is still imported
		}
		name := e.Name()
		if p != folder && (strings.HasPrefix(name, ".") || name == "node_modules") {
			if e.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !e.Type().IsRegular() {
			return nil
		}
		o, err := g.Open(p)
		if err != nil {
			return nil
		}
		same := o.Folder.RootID == rootID
		o.File.Close()
		if same {
			out = append(out, p)
		}
		return nil
	})
	sort.Strings(out)
	return out
}
