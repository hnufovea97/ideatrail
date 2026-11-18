package record

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ideatrail/engine/internal/state"
)

// stubImportRecord replaces the import's Record call; fail decides per call (1-based).
func stubImportRecord(t *testing.T, fail func(call int) error) *[][]string {
	t.Helper()
	var calls [][]string
	old := importRecord
	importRecord = func(ctx context.Context, d Deps, in Input) (*Result, error) {
		calls = append(calls, append([]string(nil), in.Paths...))
		if err := fail(len(calls)); err != nil {
			return nil, err
		}
		return &Result{Status: "sent"}, nil
	}
	t.Cleanup(func() { importRecord = old })
	return &calls
}

func journal(t *testing.T, e *env) string {
	t.Helper()
	b, _ := os.ReadFile(filepath.Join(e.d.StateDir, "journal.log"))
	return string(b)
}

// A chunk that changes while read (or grew past the record limit) is skipped; the rest goes on.
func TestImportFoldersSkipsAChangedChunkAndContinues(t *testing.T) {
	e := newEnv(t)
	e.allowance(200)
	for i := 0; i < 120; i++ {
		e.file(t, fmt.Sprintf("n%03d.md", i), "x")
	}
	calls := stubImportRecord(t, func(call int) error {
		switch call {
		case 1:
			return ErrChanged
		case 2:
			return ErrTooLarge
		}
		return nil
	})
	n, err := ImportFolders(context.Background(), e.d, []string{e.folder}, ImportLimit)
	if err != nil || n != 20 || len(*calls) != 3 {
		t.Fatalf("n=%d err=%v calls=%d, want the last chunk of 20 recorded after two skipped", n, err, len(*calls))
	}
	j := journal(t, e)
	if !strings.Contains(j, `"status":"import_skipped"`) || !strings.Contains(j, `"files":"100"`) {
		t.Fatalf("journal lacks the skip count: %s", j)
	}
	if strings.Contains(j, e.folder) || strings.Contains(j, "n000") {
		t.Fatal("journal leaks a path")
	}
}

// A full queue, an OTS or API failure or a cancelled context stops the import, and says so.
func TestImportFoldersStopsOnQueueFullAndJournalsIt(t *testing.T) {
	e := newEnv(t)
	e.allowance(200)
	for i := 0; i < 120; i++ {
		e.file(t, fmt.Sprintf("n%03d.md", i), "x")
	}
	calls := stubImportRecord(t, func(call int) error {
		if call == 2 {
			return ErrQueueFull
		}
		return nil
	})
	n, err := ImportFolders(context.Background(), e.d, []string{e.folder}, ImportLimit)
	if !errors.Is(err, ErrQueueFull) || n != MaxFiles || len(*calls) != 2 {
		t.Fatalf("n=%d err=%v calls=%d", n, err, len(*calls))
	}
	if j := journal(t, e); !strings.Contains(j, `"status":"import_stopped"`) || !strings.Contains(j, `"files":"50"`) {
		t.Fatalf("journal lacks the stop: %s", j)
	}
}

// Batches stay under the per-record byte limit; a single file over it is left out up front.
func TestImportFoldersSplitsBatchesBySize(t *testing.T) {
	e := newEnv(t)
	e.allowance(200)
	sparse := func(rel string, size int64) {
		p := e.file(t, rel, "")
		if err := os.Truncate(p, size); err != nil {
			t.Fatal(err)
		}
	}
	sparse("a.bin", MaxRecordBytes/2+1)
	sparse("b.bin", MaxRecordBytes/2+1)
	sparse("huge.bin", MaxRecordBytes+1)
	e.file(t, "c.md", "x")
	calls := stubImportRecord(t, func(int) error { return nil })
	n, err := ImportFolders(context.Background(), e.d, []string{e.folder}, ImportLimit)
	if err != nil || n != 3 {
		t.Fatalf("n=%d err=%v, want a, b and c (huge left out)", n, err)
	}
	for _, c := range *calls {
		for _, p := range c {
			if filepath.Base(p) == "huge.bin" {
				t.Fatal("a file over the record limit was imported")
			}
		}
	}
	if len(*calls) != 2 {
		t.Fatalf("records=%d, want 2 (a+b would pass the byte limit)", len(*calls))
	}
}

// The walk stops once it has enough files, or after examining a fixed number of entries.
func TestImportableStopsEarly(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 30; i++ {
		e.file(t, fmt.Sprintf("n%03d.md", i), "x")
	}
	st, _ := state.Read(e.d.StateDir)
	g := e.d.guard(st)
	if got := importable(context.Background(), g, e.folder, testRoot, 5); len(got) != 5 {
		t.Fatalf("got %d files, want 5", len(got))
	}
	old := maxImportExamined
	maxImportExamined = 10
	t.Cleanup(func() { maxImportExamined = old })
	if got := importable(context.Background(), g, e.folder, testRoot, 100); len(got) >= 10 {
		t.Fatalf("got %d files, want the walk cut at 10 entries", len(got))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := importable(ctx, g, e.folder, testRoot, 100); len(got) != 0 {
		t.Fatalf("cancelled walk returned %d files", len(got))
	}
}
