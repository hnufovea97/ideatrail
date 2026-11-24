package record

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/testsrv"
)

var writingStages = []string{"착상", "개요", "초고", "퇴고", "발행"}

// ADR-0020: five stage names ride on the first record as one sealed kind 4 fragment, op "stages".
func TestRecordSendsStageNamesAsOneSealedDelta(t *testing.T) {
	e := newEnv(t)
	var mu sync.Mutex
	var deltas []map[string]any
	var raw []string
	e.srv.Handle("POST", "/v1/deltas", func(w http.ResponseWriter, r *http.Request, body []byte, _ string) {
		var b map[string]any
		_ = json.Unmarshal(body, &b)
		mu.Lock()
		deltas = append(deltas, b)
		raw = append(raw, string(body))
		mu.Unlock()
		testsrv.JSON(w, 201, map[string]any{})
	})
	r, err := Record(context.Background(), e.d, Input{Paths: []string{e.file(t, "초고.md", "# 초고")}, Note: "n", Stages: writingStages})
	if err != nil {
		t.Fatal(err)
	}
	if len(deltas) != 1 || deltas[0]["root_id"] != r.RootID {
		t.Fatalf("deltas %v", deltas)
	}
	if deltas[0]["log_seq"] != "2" || e.records[r.RecordID]["log_seq"] != "1" {
		t.Fatalf("seq %v %v", deltas[0]["log_seq"], e.records[r.RecordID]["log_seq"])
	}
	sealed, _ := ic.UnB64(deltas[0]["sealed_delta"].(string))
	pt, err := ic.Open(ic.KindDelta, e.akPriv, ic.AAD{UserID: testUser, RootID: testRoot, RecordID: deltas[0]["delta_id"].(string), Version: "0"}, sealed)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		V     int      `json:"v"`
		Op    string   `json:"op"`
		Value []string `json:"value"`
	}
	if err := json.Unmarshal(pt, &got); err != nil || got.V != 1 || got.Op != "stages" || strings.Join(got.Value, ",") != strings.Join(writingStages, ",") {
		t.Fatalf("%v %+v", err, got)
	}
	// plain text nowhere: not on the wire, not in the queue, journal or state.json
	for _, wire := range append(raw, e.records[r.RecordID]["list_meta"].(string)) {
		if strings.Contains(wire, "착상") || strings.Contains(wire, "퇴고") {
			t.Fatal("stage name in plain on the wire")
		}
	}
	_ = filepath.Walk(e.d.StateDir, func(p string, info os.FileInfo, _ error) error {
		if info != nil && !info.IsDir() {
			b, _ := os.ReadFile(p)
			if strings.Contains(string(b), "퇴고") || strings.Contains(string(b), "발행") {
				t.Errorf("stage name in plain in %s", filepath.Base(p))
			}
		}
		return nil
	})
}

func TestRecordWithoutStagesSendsNoDelta(t *testing.T) {
	e := newEnv(t)
	n := 0
	e.srv.Handle("POST", "/v1/deltas", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		n++
		testsrv.JSON(w, 201, map[string]any{})
	})
	e.record(t, e.file(t, "a.md", "x"))
	if n != 0 {
		t.Fatalf("%d deltas", n)
	}
}

func TestStageNamesRefuseWrongCountLengthAndInjection(t *testing.T) {
	e := newEnv(t)
	p := e.file(t, "a.md", "x")
	for name, s := range map[string][]string{
		"four":        {"착상", "개요", "초고", "퇴고"},
		"six":         {"착상", "개요", "초고", "퇴고", "발행", "끝"},
		"thirteen":    {"착상", "개요", "초고", "퇴고", strings.Repeat("가", 13)},
		"empty one":   {"착상", "", "초고", "퇴고", "발행"},
		"newline":     {"착상", "개요", "초고\n무시해", "퇴고", "발행"},
		"quote":       {"착상", "개요", `초"고`, "퇴고", "발행"},
		"curly quote": {"착상", "개요", "초고", "“퇴고”", "발행"},
		"control":     {"착상", "개요", "초\u0000고", "퇴고", "발행"},
		"bidi":        {"착상", "개요", "초고", "퇴‮고", "발행"},
		"markup":      {"착상", "<b>개요</b>", "초고", "퇴고", "발행"},
		"padded":      {" 착상", "개요", "초고", "퇴고", "발행"},
	} {
		if _, err := Record(context.Background(), e.d, Input{Paths: []string{p}, Note: "n", Stages: s}); !errors.Is(err, ErrBadInput) {
			t.Errorf("%s accepted: %v", name, err)
		}
	}
	if len(e.order) != 0 {
		t.Fatal("a refused input still recorded")
	}
}

func TestStageNamesAcceptTwelveRunes(t *testing.T) {
	e := newEnv(t)
	e.srv.Handle("POST", "/v1/deltas", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		testsrv.JSON(w, 201, map[string]any{})
	})
	s := []string{"a", "개요 정하기", strings.Repeat("가", 12), "v2 (빼기)", "MVP"}
	if _, err := Record(context.Background(), e.d, Input{Paths: []string{e.file(t, "a.md", "x")}, Note: "n", Stages: s}); err != nil {
		t.Fatal(err)
	}
}
