package record

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strconv"

	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/state"
)

// Delta ops (spec §15). The engine never reads list info back; it only appends sealed changes.
var deltaOps = map[string]bool{"tags": true, "routine": true, "milestone": true, "title": true, "stages": true}

var ErrBadDelta = errors.New("unknown change type")

// Delta seals one list-info change for a root (kind 4) and uploads it in log_seq order.
func Delta(ctx context.Context, d Deps, rootID, op string, value any, recordID string) (string, error) {
	if !deltaOps[op] {
		return "", ErrBadDelta
	}
	st, err := state.Read(d.StateDir)
	if err != nil {
		return "", err
	}
	if st.UserID == "" || st.AccountPub == "" {
		return "", ErrNotPaired
	}
	if !ownsRoot(st, rootID) {
		return "", ErrNotRegistered
	}
	if countEntries(filepath.Join(d.StateDir, pendingDir)) >= MaxQueued {
		return "", ErrQueueFull
	}
	ak, err := accountKey(st.AccountPub)
	if err != nil {
		return "", err
	}
	plain := map[string]any{"v": 1, "op": op, "value": value}
	if recordID != "" {
		plain["record_id"] = recordID
	}
	pt, err := json.Marshal(plain)
	if err != nil {
		return "", err
	}
	deltaID, err := ic.NewID(randReader)
	if err != nil {
		return "", err
	}
	sealed, err := ic.Seal(ic.KindDelta, ak, ic.AAD{UserID: st.UserID, RootID: rootID, RecordID: deltaID, Version: "0"}, pt)
	if err != nil {
		return "", err
	}
	createdAt := ic.FormatTime(d.now())
	err = state.With(d.StateDir, func(s *state.State) error {
		seq, err := s.LogSeq.Next()
		if err != nil {
			return err
		}
		msg, err := ic.Delta{UserID: s.UserID, RootID: rootID, DeltaID: deltaID, DeltaSealed: sealed, LogSeq: seq, CreatedAt: createdAt}.Message()
		if err != nil {
			return err
		}
		sig, err := ic.Sign(d.Keys.Sign, msg)
		if err != nil {
			return err
		}
		body, err := json.Marshal(map[string]any{"delta_id": deltaID, "root_id": rootID, "sealed_delta": ic.B64(sealed), "log_seq": strconv.FormatUint(seq, 10), "created_at": createdAt, "engine_sig": sig})
		if err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(d.StateDir, pendingDir, deltaID+".json"), pendingFile{Kind: "delta", Path: "/v1/deltas", Body: body}); err != nil {
			return err
		}
		s.PendingUploads = append(s.PendingUploads, deltaID)
		return journalLine(d.StateDir, map[string]string{"delta_id": deltaID, "log_seq": strconv.FormatUint(seq, 10), "status": "created"})
	})
	if err != nil {
		return "", err
	}
	return Flush(ctx, d), nil
}

func ownsRoot(st *state.State, rootID string) bool {
	for _, r := range st.Folders {
		if r == rootID {
			return true
		}
	}
	return false
}
