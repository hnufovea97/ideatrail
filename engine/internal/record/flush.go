package record

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"ideatrail/engine/internal/api"
	"ideatrail/engine/internal/state"
)

type pendingFile struct {
	Kind string         `json:"kind"` // "record" | "delta"
	Path string         `json:"path"`
	Body map[string]any `json:"body"`
}

// Flush uploads queued records/deltas in order. Network errors, 5xx, 423 and 429 leave the queue
// as is (same body, same log_seq next time). Any other refusal blocks the queue: later items are
// kept, never skipped, so log_seq has no gaps (spec §2). Returns "sent", "queued" or "blocked".
func Flush(ctx context.Context, d Deps) string {
	st, err := state.Read(d.StateDir)
	if err != nil {
		return "queued"
	}
	if st.Blocked != "" {
		return "blocked"
	}
	for _, id := range st.PendingUploads {
		p := filepath.Join(d.StateDir, pendingDir, id+".json")
		raw, err := os.ReadFile(p)
		if err != nil {
			return "queued"
		}
		var pf pendingFile
		if json.Unmarshal(raw, &pf) != nil {
			return "queued"
		}
		err = d.API.Do(ctx, "POST", pf.Path, pf.Body, nil)
		var apiErr *api.Error
		switch {
		case err == nil:
		case errors.As(err, &apiErr) && !apiErr.Retryable():
			_ = state.With(d.StateDir, func(s *state.State) error { s.Blocked = apiErr.Code; return nil })
			_ = journalLine(d.StateDir, map[string]string{"record_id": id, "status": "blocked:" + apiErr.Code})
			return "blocked"
		default:
			return "queued"
		}
		if err := state.With(d.StateDir, func(s *state.State) error {
			out := s.PendingUploads[:0]
			for _, x := range s.PendingUploads {
				if x != id {
					out = append(out, x)
				}
			}
			s.PendingUploads = out
			return nil
		}); err != nil {
			return "queued"
		}
		_ = os.Remove(p)
		_ = journalLine(d.StateDir, map[string]string{"record_id": id, "status": "sent"})
	}
	return "sent"
}
