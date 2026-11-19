package mcpserver

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Claude Code shows structuredContent (when present) instead of the text: a result carrying `{}`
// reached the model as an empty answer. Tools declare no outputSchema and answer one TextContent.
func TestToolsAnswerOnlyOneFixedTextContent(t *testing.T) {
	e := newEnv(t, true)
	ctx := context.Background()
	list, err := e.cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tl := range list.Tools {
		if tl.OutputSchema != nil {
			t.Errorf("%s declares an outputSchema: %v", tl.Name, tl.OutputSchema)
		}
	}
	cases := []struct {
		name string
		args map[string]any
		want string
	}{
		{"record", map[string]any{"paths": []string{"/etc/passwd"}, "note": "x"}, msgNotAllowed},
		{"status", map[string]any{}, cleanName(filepath.Base(e.folder)) + " · 지금 단계: " + stageLabel("") + " · 아직 기록이 없어요"},
		{"request_import", map[string]any{"folders": []string{"/"}}, msgImportBad},
		{"set_record_words", map[string]any{"words": []string{"박제해"}}, wordsSetMsg([]string{"박제해"})},
	}
	for _, c := range cases {
		res, err := e.cs.CallTool(ctx, &mcp.CallToolParams{Name: c.name, Arguments: c.args})
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if res.StructuredContent != nil {
			t.Errorf("%s: structuredContent %v", c.name, res.StructuredContent)
		}
		if len(res.Content) != 1 {
			t.Fatalf("%s: %d content blocks", c.name, len(res.Content))
		}
		tc, ok := res.Content[0].(*mcp.TextContent)
		if !ok || tc.Text != c.want {
			t.Errorf("%s: content %#v, want %q", c.name, res.Content[0], c.want)
		}
	}
}
