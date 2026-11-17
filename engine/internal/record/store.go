package record

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	pendingDir = "pending"
	MaxQueued  = 500
)

var ErrQueueFull = errors.New("too many records waiting to upload")

// writeFile writes owner-only via temp file + rename (crash never leaves half a file).
func writeFile(path string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
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
