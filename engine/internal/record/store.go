package record

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"ideatrail/engine/internal/state"
)

const (
	pendingDir = "pending"
	MaxQueued  = 500
)

var ErrQueueFull = errors.New("too many records waiting to upload")

// writeFile writes owner-only and durably: unique temp file, fsync, rename, fsync the folder —
// state.json may reference this file right after, so it must survive a crash.
func writeFile(path string, b []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmp)
		}
	}()
	if err := f.Chmod(0o600); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	ok = true
	return state.SyncDir(dir)
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeFile(path, b)
}

func countEntries(dir string) int {
	es, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	n := 0
	for _, e := range es {
		if filepath.Ext(e.Name()) == ".json" {
			n++
		}
	}
	return n
}

// journalLine appends one line with ids and status only — never notes, titles or paths.
func journalLine(stateDir string, rec map[string]string) error {
	rec["at"] = time.Now().UTC().Format("2006-01-02T15:04:05Z")
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(stateDir, "journal.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = fmt.Fprintf(f, "%s\n", b)
	return err
}

// sweepOrphans removes files a crash left behind between writing them and saving state:
// pending bodies not listed in pending_uploads, and outbox entries numbered past log_seq.
func sweepOrphans(d Deps, st *state.State) {
	listed := map[string]bool{}
	for _, id := range st.PendingUploads {
		listed[id+".json"] = true
	}
	if es, err := os.ReadDir(filepath.Join(d.StateDir, pendingDir)); err == nil {
		for _, e := range es {
			if !listed[e.Name()] {
				_ = os.Remove(filepath.Join(d.StateDir, pendingDir, e.Name()))
			}
		}
	}
	if es, err := os.ReadDir(d.OutboxDir); err == nil {
		for _, e := range es {
			name := e.Name()
			if len(name) < 21 {
				continue
			}
			if seq, err := strconv.ParseUint(name[:20], 10, 64); err == nil && seq > uint64(st.LogSeq) {
				_ = os.Remove(filepath.Join(d.OutboxDir, name))
			}
		}
	}
}
