package record

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"ideatrail/engine/internal/pathguard"
	"ideatrail/engine/internal/state"
)

// ImportLimit is the signup first-import cap in files (UX "1회 200개", plan decision D1).
const ImportLimit = 200

const importNote = "가입 때 가져온 문서"

// importRecord is Record, swappable in tests.
var importRecord = Record

// maxImportExamined caps the entries one folder's walk looks at (like inbox.countFiles), so a huge
// tree cannot hold the import.
var maxImportExamined = 5000

// ImportFolders records the existing files of folders newly registered at signup: at most limit
// files in all, MaxFiles and under MaxRecordBytes per record, each record marked as the signup
// import, and never more records than the server's import allowance has left. Files the path guard
// refuses or over the record limit are left out up front; a chunk that changes while read is
// skipped and the rest goes on. A cancelled context, a full queue or an OTS/API failure stops the
// import. Files beyond the limit are left for ordinary recording when they change. The journal
// gets counts only. Returns how many files were recorded. No folders means no network call.
func ImportFolders(ctx context.Context, d Deps, folders []string, limit int) (int, error) {
	if len(folders) == 0 || limit <= 0 {
		return 0, nil
	}
	records, err := importAllowance(ctx, d)
	if err != nil {
		importJournal(d, "import_stopped", 0)
		return 0, err
	}
	st, err := state.Read(d.StateDir)
	if err != nil {
		return 0, err
	}
	g := d.guard(st)
	done, skipped := 0, 0
	for _, f := range folders {
		if done >= limit || records <= 0 {
			break
		}
		files := importable(ctx, g, f, st.Folders[f], limit-done)
		for _, chunk := range importChunks(files, limit-done) {
			if records <= 0 {
				break
			}
			_, err := importRecord(ctx, d, Input{Paths: chunk, Note: importNote, Import: true})
			if errors.Is(err, ErrChanged) || errors.Is(err, ErrTooLarge) {
				skipped += len(chunk)
				continue
			}
			if err != nil {
				importJournal(d, "import_skipped", skipped)
				importJournal(d, "import_stopped", done)
				return done, err
			}
			done += len(chunk)
			records--
		}
	}
	importJournal(d, "import_skipped", skipped)
	return done, ctx.Err()
}

// importJournal writes one count-only line (no paths, names or error text); zero skips write nothing.
func importJournal(d Deps, status string, files int) {
	if status == "import_skipped" && files == 0 {
		return
	}
	_ = journalLine(d.StateDir, map[string]string{"status": status, "files": strconv.Itoa(files)})
}

// importChunks splits files (already under the per-record byte limit each) into records of at
// most MaxFiles files and MaxRecordBytes bytes, limit files in all.
func importChunks(files []importFile, limit int) [][]string {
	var out [][]string
	var cur []string
	var size int64
	for _, f := range files {
		if limit <= 0 {
			break
		}
		if len(cur) == MaxFiles || (len(cur) > 0 && size+f.size > MaxRecordBytes) {
			out = append(out, cur)
			cur, size = nil, 0
		}
		cur = append(cur, f.path)
		size += f.size
		limit--
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out
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

type importFile struct {
	path string
	size int64
}

// importable lists, in path order, up to want regular files under folder that the guard lets this
// folder's record read: hidden entries and node_modules are skipped, and so are files of another
// registered folder nested inside (they belong to that idea) and files over the record byte limit.
// The walk stops at want files, after maxImportExamined entries, or when ctx ends.
func importable(ctx context.Context, g *pathguard.Guard, folder, rootID string, want int) []importFile {
	if rootID == "" || want <= 0 {
		return nil
	}
	var out []importFile
	examined := 0
	_ = filepath.WalkDir(folder, func(p string, e os.DirEntry, err error) error {
		if ctx.Err() != nil {
			out = nil
			return filepath.SkipAll
		}
		if examined++; examined > maxImportExamined || len(out) >= want {
			return filepath.SkipAll
		}
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
		same, size := o.Folder.RootID == rootID, o.Info.Size()
		o.File.Close()
		if same && size <= MaxRecordBytes {
			out = append(out, importFile{path: p, size: size})
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].path < out[j].path })
	return out
}
