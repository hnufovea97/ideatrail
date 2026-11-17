// Package mcpserver is the engine's MCP interface for Claude Code: record, status, request_import
// (plugin draft §4). It answers with one fixed Korean sentence; background work (inbox, GitHub
// push, uploads, receipts) runs after answering, one at a time, time-boxed.
package mcpserver

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"ideatrail/engine/internal/api"
	"ideatrail/engine/internal/inbox"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/ots"
	"ideatrail/engine/internal/pairing"
	"ideatrail/engine/internal/record"
	"ideatrail/engine/internal/repo"
	"ideatrail/engine/internal/state"
)

const (
	backgroundBudget = 20 * time.Second
	pairingCooldown  = 10 * time.Minute
)

// Engine wires the packages together.
type Engine struct {
	Version    string
	Keys       *keys.Keys
	API        *api.Client
	StateDir   string
	ProjectDir string // the Claude Code project (MCP process working directory)
	Record     record.Deps
	Repo       repo.Deps
	Inbox      inbox.Deps
	Pairing    pairing.Deps
	Computer   string

	bg          sync.Mutex
	pairMu      sync.Mutex
	lastPairing time.Time
}

func tool(name, desc string, schema map[string]any, readOnly bool) *mcp.Tool {
	f := false
	return &mcp.Tool{Name: name, Description: desc, InputSchema: schema,
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: readOnly, DestructiveHint: &f}}
}

// Server builds the MCP server (exported for tests).
func (e *Engine) Server() *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "ideatrail", Version: e.Version}, nil)
	mcp.AddTool(s, tool("record", recordDescription, recordSchema, false), safe(e.recordTool))
	mcp.AddTool(s, tool("status", statusDescription, map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}, true), safe(e.statusTool))
	mcp.AddTool(s, tool("request_import", importDescription, importSchema, false), safe(e.importTool))
	return s
}

// Run serves over stdio until the client disconnects.
func (e *Engine) Run(ctx context.Context) error { return e.Server().Run(ctx, &mcp.StdioTransport{}) }

type empty struct{}

// safe never lets an error or panic text reach the client: every outcome is a fixed sentence.
func safe[In any](h func(context.Context, In) string) mcp.ToolHandlerFor[In, empty] {
	return func(ctx context.Context, _ *mcp.CallToolRequest, in In) (res *mcp.CallToolResult, out empty, err error) {
		defer func() {
			if r := recover(); r != nil {
				res, err = text(msgFailed), nil
			}
		}()
		return text(h(ctx, in)), empty{}, nil
	}
}

func text(s string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: s}}}
}

type recordIn struct {
	Paths            []string         `json:"paths"`
	Note             string           `json:"note"`
	Milestone        string           `json:"milestone,omitempty"`
	MilestoneCertain bool             `json:"milestone_certain,omitempty"`
	Routine          []record.Routine `json:"routine,omitempty"`
	Tags             []string         `json:"tags,omitempty"`
}

func (e *Engine) recordTool(ctx context.Context, in recordIn) string {
	if msg, ok := e.ensurePaired(ctx); !ok {
		return msg
	}
	paths := make([]string, 0, len(in.Paths))
	for _, p := range in.Paths {
		if !filepath.IsAbs(p) {
			p = filepath.Join(e.ProjectDir, p)
		}
		paths = append(paths, p)
	}
	r, err := record.Record(ctx, e.Record, record.Input{Paths: paths, Note: in.Note, Milestone: in.Milestone,
		MilestoneCertain: in.MilestoneCertain, Routine: in.Routine, Tags: in.Tags})
	e.background()
	if err != nil {
		return recordError(err)
	}
	msg := "기록했어요 · " + cleanName(r.Title) + " · " + stageLabel(in.Milestone)
	if in.Milestone != "" && in.Milestone != "none" && !in.MilestoneCertain {
		msg += " (AI 추정)"
	}
	switch r.Status {
	case "queued":
		msg += suffixQueued
	case "blocked":
		msg += suffixBlocked
	}
	return msg
}

func (e *Engine) statusTool(ctx context.Context, _ struct{}) string {
	if msg, ok := e.ensurePaired(ctx); !ok {
		return msg
	}
	e.background()
	st, err := state.Read(e.StateDir)
	if err != nil {
		return msgFailed
	}
	real, _ := filepath.EvalSymlinks(e.ProjectDir)
	rootID, ok := st.Folders[real]
	if !ok {
		return msgNotRegistered
	}
	root := st.Roots[rootID]
	msg := cleanName(filepath.Base(real)) + " · " + stageLabel(root.Stage)
	if root.LastRecordID == "" {
		msg += " · 아직 기록 없음"
	}
	if st.Blocked != "" {
		msg += suffixBlocked
	}
	return msg
}

type importIn struct {
	Folders []string `json:"folders"`
}

func (e *Engine) importTool(ctx context.Context, in importIn) string {
	if msg, ok := e.ensurePaired(ctx); !ok {
		return msg
	}
	if _, err := inbox.RequestImport(ctx, e.Inbox, "import", in.Folders); err != nil {
		return importError(err)
	}
	return msgImportAsked
}

// ensurePaired starts pairing (opening the browser at most once per 10 minutes) when needed.
// Neither the link nor the pairing secret is ever part of the answer.
func (e *Engine) ensurePaired(ctx context.Context) (string, bool) {
	st, err := state.Read(e.StateDir)
	if err == nil && st.UserID != "" && st.AccountPub != "" {
		return "", true
	}
	e.pairMu.Lock()
	defer e.pairMu.Unlock()
	if time.Since(e.lastPairing) < pairingCooldown {
		return msgPairing, false
	}
	sess, err := pairing.Start(ctx, e.Pairing, e.Computer)
	if err != nil {
		return msgPairing, false
	}
	e.lastPairing = time.Now()
	go func() {
		wctx, cancel := context.WithTimeout(context.Background(), 11*time.Minute)
		defer cancel()
		if pairing.Wait(wctx, e.Pairing, sess, 3*time.Second) == nil && e.ProjectDir != "" {
			// signup step 5: offer this project folder for recording (the user picks on the dashboard)
			_, _ = inbox.RequestImport(wctx, e.Inbox, "signup_select", []string{e.ProjectDir})
		}
	}()
	return msgPairingOpened, false
}

// background runs inbox → uploads → GitHub → receipts after a tool answers, one run at a time.
func (e *Engine) background() {
	if !e.bg.TryLock() {
		return
	}
	go func() {
		defer e.bg.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), backgroundBudget)
		defer cancel()
		e.Tick(ctx)
	}()
}

// Tick is one round of background work (exported for tests and the session-start path).
func (e *Engine) Tick(ctx context.Context) {
	inbox.SendPending(ctx, e.Inbox)
	if events, err := inbox.Process(ctx, e.Inbox); err == nil {
		for _, ev := range events {
			if ev.Kind == "connect_github" {
				go func() {
					cctx, cancel := context.WithTimeout(context.Background(), 16*time.Minute)
					defer cancel()
					if repo.Connect(cctx, e.Repo) == nil {
						_, _ = repo.PushOutbox(cctx, e.Repo)
					}
				}()
			}
		}
	}
	record.Flush(ctx, e.Record)
	_, _ = record.SyncAnchors(ctx, e.Record)
	if _, err := repo.PushOutbox(ctx, e.Repo); err != nil && !errors.Is(err, repo.ErrNotConnected) {
		return
	}
}

func isOTS(err error) bool { return errors.Is(err, ots.ErrTooFewReceipts) }
