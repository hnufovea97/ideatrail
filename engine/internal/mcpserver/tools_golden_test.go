package mcpserver

import (
	"context"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var updateGolden = flag.Bool("update", false, "rewrite plugin/tools.json")

type goldenTool struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	InputSchema any    `json:"inputSchema"`
}

// plugin/tools.json is what the server advertises (name, description, inputSchema). The token-budget
// script (scripts/measure-tokens.mjs) reads it, so a tool change must show up there.
func TestAdvertisedToolsMatchPluginToolsJSON(t *testing.T) {
	e := &Engine{StateDir: t.TempDir()}
	st, ct := mcp.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := e.Server().Connect(ctx, st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "golden"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	list, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	tools := make([]goldenTool, 0, len(list.Tools))
	for _, tl := range list.Tools {
		tools = append(tools, goldenTool{tl.Name, tl.Description, tl.InputSchema})
	}
	got, err := json.MarshalIndent(tools, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	got = append(got, '\n')
	path := filepath.Join("..", "..", "..", "plugin", "tools.json")
	if *updateGolden || os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(want) != string(got) {
		t.Fatalf("plugin/tools.json is stale; run: (cd engine && go test ./internal/mcpserver -run TestAdvertisedTools -update)\n%s", got)
	}
}
