package record

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/ots"
	"ideatrail/engine/internal/state"
)

var idRe = regexp.MustCompile(`^[0-9a-hjkmnp-tv-z]{26}$`)

type confirmedPage struct {
	Anchors []struct {
		RecordID        string `json:"record_id"`
		CompleteReceipt string `json:"complete_receipt"`
		BlockHeight     uint64 `json:"block_height"`
		ChangeSeq       uint64 `json:"change_seq"`
	} `json:"anchors"`
	NextCursor *uint64 `json:"next_cursor"`
}

// SyncAnchors pulls Bitcoin-confirmed receipts and updates the local copies (spec §12-13).
// The server is untrusted: ids must be well-formed and already ours locally, and each receipt
// must parse from our own commitment and carry a bitcoin attestation before it is stored.
func SyncAnchors(ctx context.Context, d Deps) (int, error) {
	st, err := state.Read(d.StateDir)
	if err != nil {
		return 0, err
	}
	cursor := uint64(st.AnchorsCursor)
	updated := 0
	for pages := 0; pages < 20; pages++ {
		var page confirmedPage
		if err := d.API.Do(ctx, "GET", "/v1/anchors/confirmed?since="+strconv.FormatUint(cursor, 10), nil, &page); err != nil {
			return updated, err
		}
		for _, a := range page.Anchors {
			if a.ChangeSeq > cursor {
				cursor = a.ChangeSeq
			}
			if !idRe.MatchString(a.RecordID) {
				continue
			}
			ok, err := applyConfirmed(d, a.RecordID, a.CompleteReceipt, a.BlockHeight)
			if err != nil || !ok {
				continue
			}
			updated++
			_ = d.API.Do(ctx, "POST", "/v1/anchors/"+a.RecordID+"/synced", map[string]string{"target": "local"}, nil)
		}
		if err := state.With(d.StateDir, func(s *state.State) error { s.AnchorsCursor = state.Seq(cursor); return nil }); err != nil {
			return updated, err
		}
		if page.NextCursor == nil {
			break
		}
	}
	return updated, nil
}

func applyConfirmed(d Deps, recordID, receiptB64 string, height uint64) (bool, error) {
	path := filepath.Join(d.ProofDir, recordID, "bundle.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return false, nil // not one of ours on this machine
	}
	var b map[string]any
	if json.Unmarshal(raw, &b) != nil {
		return false, nil
	}
	if done, _ := b["ots_complete"].(string); done != "" {
		return false, nil // never replace a stored proof with whatever the server sends later
	}
	commitHex, _ := b["commitment"].(string)
	commitment, err := hex.DecodeString(commitHex)
	if err != nil || len(commitment) != 32 {
		return false, nil
	}
	receipt, err := ic.UnB64(receiptB64)
	if err != nil {
		return false, nil
	}
	tree, err := ots.Parse(receipt, commitment)
	if err != nil || tree.BitcoinHeight() == 0 {
		return false, nil
	}
	b["ots_complete"] = receiptB64
	b["block_height"] = tree.BitcoinHeight()
	b["local_synced_at"] = time.Now().UTC().Format("2006-01-02T15:04:05Z")
	return true, writeJSON(path, b)
}
