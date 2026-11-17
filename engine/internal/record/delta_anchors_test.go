package record

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/testsrv"
)

func TestDeltasShareTheLogSeqSpace(t *testing.T) {
	e := newEnv(t)
	var deltas []map[string]any
	e.srv.Handle("POST", "/v1/deltas", func(w http.ResponseWriter, r *http.Request, body []byte, _ string) {
		var b map[string]any
		_ = json.Unmarshal(body, &b)
		deltas = append(deltas, b)
		testsrv.JSON(w, 201, map[string]any{})
	})
	e.record(t, e.file(t, "a.md", "x"))
	if s, err := Delta(context.Background(), e.d, testRoot, "tags", []string{"finance"}, ""); err != nil || s != "sent" {
		t.Fatalf("%v %s", err, s)
	}
	e.record(t, e.file(t, "b.md", "y"))
	if deltas[0]["log_seq"] != "2" || e.records[e.order[1]]["log_seq"] != "3" {
		t.Fatalf("seq %v %v", deltas[0]["log_seq"], e.records[e.order[1]]["log_seq"])
	}
	if _, err := Delta(context.Background(), e.d, testRoot, "drop_table", nil, ""); !errors.Is(err, ErrBadDelta) {
		t.Fatal("unknown op accepted")
	}
	if _, err := Delta(context.Background(), e.d, "01jcm3v8q7s2kx4f9d6b5n0tqz", "tags", nil, ""); !errors.Is(err, ErrNotRegistered) {
		t.Fatal("foreign root accepted")
	}
}

func TestSyncAnchorsTrustsNothingFromTheServer(t *testing.T) {
	e := newEnv(t)
	r := e.record(t, e.file(t, "a.md", "x"))
	// The real upgraded alice receipt is for the M0 digest; make this record's commitment that digest.
	raw, _ := os.ReadFile("../../../spec/vectors/ots/receipts.json")
	var fx struct {
		Digest string `json:"digest_hex"`
		OTS    string `json:"direct_alice_ots_hex"`
	}
	_ = json.Unmarshal(raw, &fx)
	bp := filepath.Join(e.d.ProofDir, r.RecordID, "bundle.json")
	var b map[string]any
	lb, _ := os.ReadFile(bp)
	_ = json.Unmarshal(lb, &b)
	b["commitment"] = fx.Digest
	nb, _ := json.Marshal(b)
	_ = os.WriteFile(bp, nb, 0o600)
	full, _ := hex.DecodeString(fx.OTS)
	complete := ic.B64(full[31+1+1+32:])

	var synced []string
	e.srv.Handle("POST", "/v1/anchors/:id/synced", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		synced = append(synced, r.URL.Path)
		testsrv.JSON(w, 200, map[string]any{})
	})
	e.srv.Handle("GET", "/v1/anchors/confirmed", func(w http.ResponseWriter, req *http.Request, _ []byte, _ string) {
		testsrv.JSON(w, 200, map[string]any{"next_cursor": nil, "anchors": []map[string]any{
			{"record_id": "../../etc/passwd", "complete_receipt": complete, "block_height": 1, "change_seq": 5},
			{"record_id": "01jcm3v8q7s2kx4f9d6b5n0tqz", "complete_receipt": complete, "block_height": 1, "change_seq": 6}, // not ours
			{"record_id": r.RecordID, "complete_receipt": ic.B64([]byte{0x02}), "block_height": 1, "change_seq": 7},       // junk receipt
		}})
	})
	n, err := SyncAnchors(context.Background(), e.d)
	if err != nil || n != 0 || len(synced) != 0 {
		t.Fatalf("n=%d err=%v synced=%v", n, err, synced)
	}
	e.srv.Handle("GET", "/v1/anchors/confirmed", func(w http.ResponseWriter, req *http.Request, _ []byte, _ string) {
		testsrv.JSON(w, 200, map[string]any{"next_cursor": nil, "anchors": []map[string]any{
			{"record_id": r.RecordID, "complete_receipt": complete, "block_height": 975755, "change_seq": 8},
		}})
	})
	n, err = SyncAnchors(context.Background(), e.d)
	if err != nil || n != 1 || len(synced) != 1 {
		t.Fatalf("n=%d err=%v synced=%v", n, err, synced)
	}
	lb, _ = os.ReadFile(bp)
	_ = json.Unmarshal(lb, &b)
	if b["block_height"].(float64) != 975755 || b["local_synced_at"] == nil {
		t.Fatalf("bundle %v", b)
	}
}
