package record

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"ideatrail/engine/internal/api"
	"ideatrail/engine/internal/state"
)

type pendingFile struct {
	Kind string          `json:"kind"` // "record" | "delta"
	Path string          `json:"path"`
	Body json.RawMessage `json:"body"` // sent byte-for-byte as first signed (no float64 round trip)
}

// Version is the engine build version; a new version clears a previous block and retries.
var Version = "dev"

func block(d Deps, code, id string) string {
	_ = state.With(d.StateDir, func(s *state.State) error { s.Blocked, s.BlockedVersion = code, Version; return nil })
	_ = journalLine(d.StateDir, map[string]string{"id": id, "status": "blocked:" + code})
	return "blocked"
}

// flushLocks serializes Flush per engine folder inside this process; flush.lock does the same
// across engine processes. Two flushes working from one queue snapshot would re-send a record the
// other already sent (409) or find its pending file removed (pending_missing), and block the queue.
var flushLocks sync.Map // StateDir → *sync.Mutex

const (
	flushLock     = "flush.lock"
	flushLockWait = 3 * time.Minute // another process's flush, item by item
)

func lockFlush(stateDir string) (func(), error) {
	m, _ := flushLocks.LoadOrStore(stateDir, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	unlock, err := state.LockFile(stateDir, flushLock, flushLockWait)
	if err != nil {
		mu.Unlock()
		return nil, err
	}
	return func() { unlock(); mu.Unlock() }, nil
}

// Flush uploads queued records/deltas in order. Network errors, 5xx, 423 and 429 leave the queue
// as is (same body, same log_seq next time). Any other refusal blocks the queue: later items are
// kept, never skipped, so log_seq has no gaps (spec §2). Returns "sent", "queued" or "blocked".
// One Flush at a time per engine folder; the queue is re-read before each item.
func Flush(ctx context.Context, d Deps) string {
	unlock, err := lockFlush(d.StateDir)
	if err != nil {
		return "queued"
	}
	defer unlock()
	st, err := state.Read(d.StateDir)
	if err != nil {
		return "queued"
	}
	if st.Blocked != "" {
		if st.BlockedVersion == Version {
			return "blocked"
		}
		_ = state.With(d.StateDir, func(s *state.State) error { s.Blocked, s.BlockedVersion = "", ""; return nil })
	}
	for {
		if ctx.Err() != nil {
			return "queued"
		}
		st, err := state.Read(d.StateDir)
		if err != nil {
			return "queued"
		}
		if len(st.PendingUploads) == 0 {
			return "sent"
		}
		if status, ok := flushOne(ctx, d, st.PendingUploads[0]); !ok {
			return status
		}
	}
}

// flushOne sends one queued item and removes it from the queue; ok=false stops the flush with status.
func flushOne(ctx context.Context, d Deps, id string) (string, bool) {
	p := filepath.Join(d.StateDir, pendingDir, id+".json")
	raw, err := os.ReadFile(p)
	if err != nil {
		return block(d, "pending_missing", id), false
	}
	var pf pendingFile
	if json.Unmarshal(raw, &pf) != nil || (pf.Path != "/v1/records" && pf.Path != "/v1/deltas") {
		return block(d, "pending_corrupt", id), false
	}
	err = d.API.Do(ctx, "POST", pf.Path, pf.Body, nil)
	var apiErr *api.Error
	switch {
	case err == nil:
	case errors.As(err, &apiErr) && !apiErr.Retryable():
		// Includes 409: with log_seq persisted before any send, a conflict means local state
		// diverged from the server — stop and surface it rather than guess (decided in M3a review).
		return block(d, apiErr.Code, id), false
	default:
		return "queued", false
	}
	if err := state.With(d.StateDir, func(s *state.State) error {
		out := make([]string, 0, len(s.PendingUploads))
		for _, x := range s.PendingUploads {
			if x != id {
				out = append(out, x)
			}
		}
		s.PendingUploads = out
		return nil
	}); err != nil {
		return "queued", false
	}
	_ = os.Remove(p)
	_ = journalLine(d.StateDir, map[string]string{"record_id": id, "status": "sent"})
	return "sent", true
}
