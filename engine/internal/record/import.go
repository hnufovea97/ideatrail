package record

import (
	"context"
	"errors"
	"os"
	"path/filepath"
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

// maxImportAttempts bounds how often an import that keeps stopping is resumed.
const maxImportAttempts = 5

// ImportFolders starts the signup first import for folders and runs it (see ResumeImport).
func ImportFolders(ctx context.Context, d Deps, folders []string, limit int) (int, error) {
	if err := StartImport(d, folders); err != nil {
		return 0, err
	}
	return ResumeImport(ctx, d, limit)
}

// StartImport saves folders as the first import to run; folders already waiting are kept.
func StartImport(d Deps, folders []string) error {
	if len(folders) == 0 {
		return nil
	}
	return state.With(d.StateDir, func(s *state.State) error {
		job := state.ImportJob{}
		if s.Import != nil {
			job = *s.Import
		}
		have := map[string]bool{}
		for _, f := range job.Folders {
			have[f] = true
		}
		for _, f := range folders {
			if !have[f] {
				job.Folders = append(job.Folders, f)
				have[f] = true
			}
		}
		s.Import = &job
		return nil
	})
}

// ImportPending reports whether a first import is waiting to run or resume.
func ImportPending(d Deps) bool {
	st, err := state.Read(d.StateDir)
	return err == nil && st.Import != nil
}

// ResumeImport runs the saved first import from where it stopped: at most limit files in all,
// MaxFiles and under MaxRecordBytes per record, each record marked as the signup import, and never
// more records than the server's import allowance has left. Files the path guard refuses or over
// the record limit are left out up front; a chunk that changes while read is skipped and the rest
// goes on. A cancelled context, a full queue or an OTS/API failure stops it and keeps the job for
// the next run. Files beyond the limit are left for ordinary recording when they change. The
// journal gets counts only. Returns how many files this run recorded. No job means no network call.
func ResumeImport(ctx context.Context, d Deps, limit int) (int, error) {
	st, err := state.Read(d.StateDir)
	if err != nil || st.Import == nil {
		return 0, err
	}
	job := *st.Import
	if job.Attempts >= maxImportAttempts || limit <= 0 {
		importJournal(d, "import_given_up", job.Done)
		return 0, saveImport(d, nil)
	}
	job.Attempts++
	if err := saveImport(d, &job); err != nil {
		return 0, err
	}
	records, err := importAllowance(ctx, d)
	if err != nil {
		importJournal(d, "import_stopped", job.Done)
		return 0, err
	}
	g := d.guard(st)
	done, skipped := 0, 0
	for job.Folder < len(job.Folders) && job.Done < limit && records > 0 {
		f := job.Folders[job.Folder]
		files := importable(ctx, g, f, st.Folders[f], job.Skip+limit-job.Done)
		if err := ctx.Err(); err != nil {
			return done, err
		}
		files = files[min(job.Skip, len(files)):]
		for _, chunk := range importChunks(files, limit-job.Done) {
			if records <= 0 {
				break
			}
			_, err := importRecord(ctx, d, Input{Paths: chunk, Note: importNote, Import: true})
			switch {
			case err == nil:
				done, job.Done, records = done+len(chunk), job.Done+len(chunk), records-1
			case errors.Is(err, ErrChanged) || errors.Is(err, ErrTooLarge):
				skipped += len(chunk)
			default:
				importJournal(d, "import_skipped", skipped)
				importJournal(d, "import_stopped", job.Done)
				return done, err
			}
			job.Skip += len(chunk)
			_ = saveImport(d, &job)
		}
		if records <= 0 || job.Done >= limit {
			break
		}
		job.Folder, job.Skip = job.Folder+1, 0
		_ = saveImport(d, &job)
	}
	importJournal(d, "import_skipped", skipped)
	return done, saveImport(d, nil)
}

func saveImport(d Deps, job *state.ImportJob) error {
	return state.With(d.StateDir, func(s *state.State) error { s.Import = job; return nil })
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

// importable lists, in walk order (by name, folder by folder; stable, so a resume can skip what it
// handled), up to want regular files under folder that the guard lets this
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
	return out
}
