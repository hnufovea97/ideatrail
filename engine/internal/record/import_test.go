package record

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"sync/atomic"
	"testing"

	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/testsrv"
)

// allowance serves GET /v1/import-allowance (the server creates the signup allowance on first ask).
func (e *env) allowance(remaining int) *atomic.Int32 {
	var asked atomic.Int32
	e.srv.Handle("GET", "/v1/import-allowance", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		asked.Add(1)
		testsrv.JSON(w, 200, map[string]any{"remaining": remaining, "expires_at": "2099-01-01T00:00:00Z"})
	})
	return &asked
}

func TestImportFoldersRecordsInChunksMarkedAsImport(t *testing.T) {
	e := newEnv(t)
	e.allowance(200)
	for i := 0; i < 120; i++ {
		e.file(t, fmt.Sprintf("docs/n%03d.md", i), "메모")
	}
	e.file(t, ".DS_Store", "x")
	n, err := ImportFolders(context.Background(), e.d, []string{e.folder}, ImportLimit)
	if err != nil {
		t.Fatal(err)
	}
	if n != 120 {
		t.Fatalf("imported %d files, want 120 (hidden files skipped)", n)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.order) != 3 {
		t.Fatalf("records = %d, want 3 (50 + 50 + 20)", len(e.order))
	}
	for _, id := range e.order {
		if e.records[id]["import"] != true {
			t.Fatalf("record %s is not marked as the signup import", id)
		}
	}
}

func TestImportFoldersStopsAtTheLimit(t *testing.T) {
	e := newEnv(t)
	e.allowance(200)
	for i := 0; i < 5; i++ {
		e.file(t, fmt.Sprintf("n%d.md", i), "x")
	}
	n, err := ImportFolders(context.Background(), e.d, []string{e.folder}, 3)
	if err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if n != 3 || len(e.order) != 1 {
		t.Fatalf("n=%d records=%d, want 3 files in 1 record", n, len(e.order))
	}
}

func TestOrdinaryRecordsCarryNoImportFlag(t *testing.T) {
	e := newEnv(t)
	r := e.record(t, e.file(t, "docs/plan.md", "계획"))
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, ok := e.records[r.RecordID]["import"]; ok {
		t.Fatal("an ordinary record must not use the import allowance")
	}
}

// Files the guard would refuse (secret-looking names, .ideaignore) are left out up front, so one
// of them can never stop the whole import.
func TestImportFoldersSkipsFilesTheGuardRefuses(t *testing.T) {
	e := newEnv(t)
	e.allowance(200)
	e.file(t, "plan.md", "x")
	e.file(t, "api-token.txt", "x")
	e.file(t, "server.pem", "x")
	e.file(t, "draft/skip.md", "x")
	e.file(t, ".ideaignore", "draft/\n")
	n, err := ImportFolders(context.Background(), e.d, []string{e.folder}, ImportLimit)
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v, want only plan.md", n, err)
	}
}

// A folder registered inside another one belongs to its own idea: the outer import skips it.
func TestImportFoldersSkipsNestedRegisteredFolders(t *testing.T) {
	e := newEnv(t)
	e.allowance(200)
	e.file(t, "plan.md", "x")
	inner := filepath.Dir(e.file(t, "inner/a.md", "x"))
	e.register(t, inner)
	n, err := ImportFolders(context.Background(), e.d, []string{e.folder}, ImportLimit)
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v, want only the outer folder's own file", n, err)
	}
}

// Nothing chosen (the browser sent zero folders): no allowance asked, no record made.
func TestImportFoldersDoesNothingForNoFolders(t *testing.T) {
	e := newEnv(t)
	asked := e.allowance(200)
	e.file(t, "plan.md", "x")
	n, err := ImportFolders(context.Background(), e.d, nil, ImportLimit)
	if err != nil || n != 0 || asked.Load() != 0 {
		t.Fatalf("n=%d err=%v asked=%d", n, err, asked.Load())
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.order) != 0 {
		t.Fatal("recorded without a chosen folder")
	}
}

// The server's allowance is counted in records: never queue more import records than it has left
// (a record over the allowance would be refused with a retryable 429 and hold the queue).
func TestImportFoldersStaysWithinTheServerAllowance(t *testing.T) {
	e := newEnv(t)
	asked := e.allowance(1)
	for i := 0; i < 70; i++ {
		e.file(t, fmt.Sprintf("n%03d.md", i), "x")
	}
	n, err := ImportFolders(context.Background(), e.d, []string{e.folder}, ImportLimit)
	if err != nil || n != MaxFiles || asked.Load() != 1 {
		t.Fatalf("n=%d err=%v asked=%d, want one record of %d files", n, err, asked.Load(), MaxFiles)
	}
}

func (e *env) register(t *testing.T, folder string) {
	t.Helper()
	if err := state.With(e.d.StateDir, func(s *state.State) error {
		s.Folders[folder] = "01jcm3v8q7s2kx4f9d6b5n0tqz"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
