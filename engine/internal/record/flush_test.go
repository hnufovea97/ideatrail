package record

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/testsrv"
)

// Flush runs from the signup first import (Record → Flush) and the watcher (Tick → Flush) at the
// same time. Both must not work from stale queue snapshots: a stale one re-POSTs a sent record
// (409 → blocked) or finds its pending file gone (pending_missing → blocked).
func TestConcurrentFlushesSendEachRecordOnceAndNeverBlock(t *testing.T) {
	e := newEnv(t)
	var mu sync.Mutex
	posts := map[string]int{}
	e.srv.Handle("POST", "/v1/records", func(w http.ResponseWriter, r *http.Request, body []byte, _ string) {
		var b map[string]any
		_ = json.Unmarshal(body, &b)
		id, _ := b["record_id"].(string)
		time.Sleep(5 * time.Millisecond) // widen the window a stale snapshot would hit
		mu.Lock()
		posts[id]++
		n := posts[id]
		mu.Unlock()
		if n > 1 {
			testsrv.Fail(w, 409, "log_seq_conflict") // the real server refuses a repeat
			return
		}
		testsrv.JSON(w, 201, map[string]any{"record_id": id})
	})
	const records = 6
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < records; i++ {
			_, _ = Record(context.Background(), e.d, Input{Paths: []string{e.file(t, fmt.Sprintf("n%d.md", i), "x")}, Note: "n"})
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 40; i++ {
			Flush(context.Background(), e.d)
			time.Sleep(time.Millisecond)
		}
	}()
	wg.Wait()
	Flush(context.Background(), e.d)
	st, err := state.Read(e.d.StateDir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Blocked != "" {
		t.Fatalf("queue blocked: %s", st.Blocked)
	}
	if len(st.PendingUploads) != 0 {
		t.Fatalf("still pending: %v", st.PendingUploads)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(posts) != records {
		t.Fatalf("posted %d records, want %d", len(posts), records)
	}
	for id, n := range posts {
		if n != 1 {
			t.Fatalf("record %s posted %d times", id, n)
		}
	}
}

// The import's Record and the record tool's Record can run together: one's orphan sweep must not
// remove the pending file the other has just written and queued.
func TestConcurrentRecordsKeepEachOthersPendingFiles(t *testing.T) {
	e := newEnv(t)
	e.srv.FailNext(1000, 503) // keep everything queued so sweeps see pending files
	const each = 4
	var wg sync.WaitGroup
	for g := 0; g < 2; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < each; i++ {
				_, _ = Record(context.Background(), e.d, Input{Paths: []string{e.file(t, fmt.Sprintf("g%d-%d.md", g, i), "x")}, Note: "n"})
			}
		}(g)
	}
	wg.Wait()
	st, _ := state.Read(e.d.StateDir)
	if len(st.PendingUploads) != 2*each {
		t.Fatalf("queued %d, want %d", len(st.PendingUploads), 2*each)
	}
	for _, id := range st.PendingUploads {
		if _, err := os.Stat(filepath.Join(e.d.StateDir, pendingDir, id+".json")); err != nil {
			t.Fatalf("pending file of %s removed by a concurrent sweep", id)
		}
	}
}
