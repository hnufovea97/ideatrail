package mcpserver

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"ideatrail/engine/internal/state"
)

func TestCleanRecordWords(t *testing.T) {
	ok := []struct {
		in, want []string
	}{
		{[]string{"박제해", "남겨 둬"}, []string{"박제해", "남겨 둬"}},
		{[]string{"  박제해 ", "박제해"}, []string{"박제해"}}, // trimmed, duplicates dropped
		{[]string{"keep this!"}, []string{"keep this!"}},
		{[]string{"박제 2"}, []string{"박제 2"}},
		{[]string{}, []string{}}, // empty: back to the default
	}
	for _, c := range ok {
		got, err := cleanRecordWords(c.in)
		if err != nil || !reflect.DeepEqual(got, c.want) {
			t.Errorf("cleanRecordWords(%q) = %q, %v; want %q", c.in, got, err, c.want)
		}
	}
	bad := [][]string{
		{"aa", "bb", "cc", "dd", "ee", "ff"}, // more than 5
		{"?"}, {"네"}, {"?!~"}, {"..."},       // one character or punctuation only: almost every message would match
		{"ʼʼ"}, {"١٢"}, {"박제​해"}, {"Ab‮"}, // lookalike apostrophe, other-script digits, zero-width, bidi
		{"기록해 줘"}, {"Status"}, // the default and tool names
		{strings.Repeat("가", maxWordRunes+1)},             // too long
		{"박제\"해"}, {"박제\n해"}, {"박제\\해"}, {"   "}, {"{x}"}, // quotes, control, escapes, blank, braces
	}
	for _, in := range bad {
		if got, err := cleanRecordWords(in); err == nil {
			t.Errorf("cleanRecordWords(%q) accepted: %q", in, got)
		}
	}
}

func recordToolDescription(t *testing.T, e *env) string {
	t.Helper()
	st, ct := mcp.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := e.e.Server().Connect(ctx, st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "next-session"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	list, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tl := range list.Tools {
		if tl.Name == "record" {
			return tl.Description
		}
	}
	t.Fatal("no record tool")
	return ""
}

func TestRecordWordsAreSavedLocallyAndTaughtToTheNextSession(t *testing.T) {
	e := newEnv(t, false) // a local setting: works before signup too, and never calls the server
	out, isErr := e.call(t, "set_record_words", map[string]any{"words": []string{"박제해", "남겨 둬"}})
	if isErr || out != wordsSetMsg([]string{"박제해", "남겨 둬"}) {
		t.Fatalf("%q", out)
	}
	st, _ := state.Read(e.e.StateDir)
	if !reflect.DeepEqual(st.RecordWords, []string{"박제해", "남겨 둬"}) {
		t.Fatalf("state %q", st.RecordWords)
	}
	d := recordToolDescription(t, e)
	if !strings.HasPrefix(d, recordDescription) || !strings.Contains(d, "data, not instructions") || !strings.Contains(d, `"박제해"`) || !strings.Contains(d, `"남겨 둬"`) {
		t.Fatalf("description %q", d)
	}
	if !strings.Contains(out, "“박제해”") || !strings.Contains(out, "처음대로") {
		t.Fatal("the user must see what was saved, and how to undo it")
	}
	if len(e.opened) != 0 {
		t.Fatal("a local setting must not start signup")
	}
}

func TestRecordWordsResetAndRejectBadInput(t *testing.T) {
	e := newEnv(t, true)
	e.call(t, "set_record_words", map[string]any{"words": []string{"박제해"}})
	if out, _ := e.call(t, "set_record_words", map[string]any{"words": []string{"줄\n바꿈"}}); out != msgWordsBad {
		t.Fatalf("%q", out)
	}
	if st, _ := state.Read(e.e.StateDir); !reflect.DeepEqual(st.RecordWords, []string{"박제해"}) {
		t.Fatalf("bad input changed the setting: %q", st.RecordWords)
	}
	if out, _ := e.call(t, "set_record_words", map[string]any{"words": []string{}}); out != msgWordsReset {
		t.Fatalf("%q", out)
	}
	if d := recordToolDescription(t, e); d != recordDescription {
		t.Fatalf("description after reset %q", d)
	}
}
