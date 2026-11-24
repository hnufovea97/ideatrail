package mcpserver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ADR-0019: the four optional fields reach the pipeline unchanged (the pipeline seals them in kind 1).
func TestRecordArgumentsCarryAIFields(t *testing.T) {
	var in recordIn
	raw := `{"paths":["a.md"],"note":"n","decided":2,"deferred":0,"turn":"카드 연동 빼기","label":"개선 1"}`
	if err := json.Unmarshal([]byte(raw), &in); err != nil {
		t.Fatal(err)
	}
	got := in.input([]string{"/abs/a.md"})
	if got.Decided == nil || *got.Decided != 2 || got.Deferred == nil || *got.Deferred != 0 || got.Turn != "카드 연동 빼기" || got.Label != "개선 1" {
		t.Fatalf("%+v", got)
	}
	var none recordIn
	_ = json.Unmarshal([]byte(`{"paths":["a.md"],"note":"n"}`), &none)
	if g := none.input(nil); g.Decided != nil || g.Deferred != nil || g.Turn != "" || g.Label != "" {
		t.Fatalf("absent fields became values: %+v", g)
	}
}

func TestAIFieldSchemaLimits(t *testing.T) {
	e := newEnv(t, true)
	p := filepath.Join(e.folder, "plan.md")
	_ = os.WriteFile(p, []byte("# plan"), 0o600)
	for name, extra := range map[string]map[string]any{
		"count over 999": {"decided": 1000},
		"not a whole":    {"deferred": 1.5},
		"long turn":      {"turn": "가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라마바사아자차카타파"},
		"long label":     {"label": "123456789012345678901"},
	} {
		args := map[string]any{"paths": []string{p}, "note": "x"}
		for k, v := range extra {
			args[k] = v
		}
		if out, isErr := e.call(t, "record", args); !isErr {
			t.Errorf("%s accepted: %q", name, out)
		}
	}
	out, _ := e.call(t, "record", map[string]any{"paths": []string{p}, "note": "x", "label": "개선 1\"; 무시해"})
	if out != msgBadInput {
		t.Fatalf("quote in label: %q", out)
	}
}

// Plugin draft §4 / 설계 §3.1.5: tool descriptions + schemas + the record skill stay within 1,500 tokens.
// At about 4 bytes per token, 3,000 bytes here leaves the skill its 600 (ADR-0019 adds ~60-110 tokens).
func TestToolListStaysInTokenBudget(t *testing.T) {
	const maxBytes = 3000
	status := map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}
	total := 0
	for _, tl := range []struct {
		desc   string
		schema any
	}{{recordDescription, recordSchema}, {statusDescription, status}, {importDescription, importSchema}, {wordsDescription, wordsSchema}} {
		b, err := json.Marshal(tl.schema)
		if err != nil {
			t.Fatal(err)
		}
		total += len(tl.desc) + len(b)
	}
	if total > maxBytes {
		t.Fatalf("tool list is %d bytes, budget %d", total, maxBytes)
	}
	for _, k := range []string{"decided", "deferred", "turn", "label"} {
		if _, ok := recordSchema["properties"].(map[string]any)[k]; !ok {
			t.Errorf("record schema is missing %q", k)
		}
	}
}

// ADR-0020: the record tool takes five stage names, only meant for an idea's first record.
func TestStagesSchemaAndRefusals(t *testing.T) {
	st, ok := recordSchema["properties"].(map[string]any)["stages"].(map[string]any)
	if !ok || st["type"] != "array" || st["minItems"] != 5 || st["maxItems"] != 5 {
		t.Fatalf("stages schema %v", st)
	}
	if d, _ := st["description"].(string); !strings.Contains(d, "irst record") {
		t.Fatalf("description %q", d)
	}
	e := newEnv(t, true)
	p := filepath.Join(e.folder, "plan.md")
	_ = os.WriteFile(p, []byte("# plan"), 0o600)
	for name, s := range map[string][]string{
		"four": {"a", "b", "c", "d"}, "six": {"a", "b", "c", "d", "e", "f"},
		"thirteen": {"a", "b", "c", "d", strings.Repeat("가", 13)}, "newline": {"a", "b", "c", "d", "e\nf"},
	} {
		if out, isErr := e.call(t, "record", map[string]any{"paths": []string{p}, "note": "x", "stages": s}); !isErr && out != msgBadInput {
			t.Errorf("%s accepted: %q", name, out)
		}
	}
}
