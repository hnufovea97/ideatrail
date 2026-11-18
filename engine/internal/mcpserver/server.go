// Package mcpserver is the engine's MCP interface for Claude Code: record, status, request_import
// (plugin draft §4). It answers with one fixed Korean sentence; background work (inbox, GitHub
// push, uploads, receipts) runs after answering, one at a time, time-boxed.
package mcpserver

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
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
	closeWait        = 5 * time.Second
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
	Home       func() (string, error) // the person's home folder; default os.UserHomeDir (tests inject a temp one)

	timing      signupTiming // zero: defaultSignupTiming
	bg          sync.Mutex
	pairMu      sync.Mutex
	lastPairing time.Time
	connecting  atomic.Bool
	importing   atomic.Bool
	life        sync.Mutex // guards closing and wg.Add against Close
	closing     bool
	wg          sync.WaitGroup
	baseOnce    sync.Once
	base        context.Context
	stop        context.CancelFunc
}

// ctxBase is cancelled by Close, so background work stops when the server does.
func (e *Engine) ctxBase() context.Context {
	e.baseOnce.Do(func() { e.base, e.stop = context.WithCancel(context.Background()) })
	return e.base
}

func (e *Engine) home() (string, error) {
	if e.Home != nil {
		return e.Home()
	}
	return os.UserHomeDir()
}

// goSafe runs fn in a tracked goroutine; a panic there must not take the MCP server down and is
// journaled as a fixed line (the panic value could carry a path or a secret). Once Close has
// started it refuses new work and reports false.
func (e *Engine) goSafe(fn func()) bool {
	e.life.Lock()
	defer e.life.Unlock()
	if e.closing {
		return false
	}
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		defer func() {
			if recover() != nil {
				record.Journal(e.StateDir, "panic_recovered")
			}
		}()
		fn()
	}()
	return true
}

// Close cancels background work and waits for it (up to wait) so files are not left half-written.
func (e *Engine) Close(wait time.Duration) {
	e.ctxBase()
	e.life.Lock()
	e.closing = true
	e.life.Unlock()
	e.stop()
	done := make(chan struct{})
	go func() { e.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(wait):
	}
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
func (e *Engine) Run(ctx context.Context) error {
	defer e.Close(closeWait)
	return e.Server().Run(ctx, &mcp.StdioTransport{})
}

// safe never lets an error or panic text reach the client: every outcome is a fixed sentence.
// Out is `any` and the output nil, so the SDK declares no outputSchema and sends no
// structuredContent: Claude Code shows structuredContent instead of the text when it is present.
func safe[In any](h func(context.Context, In) string) mcp.ToolHandlerFor[In, any] {
	return func(ctx context.Context, _ *mcp.CallToolRequest, in In) (res *mcp.CallToolResult, out any, err error) {
		defer func() {
			if r := recover(); r != nil {
				res, out, err = text(msgFailed), nil, nil
			}
		}()
		return text(h(ctx, in)), nil, nil
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
	msg := "기록했어요 · " + cleanName(r.Title)
	if in.Milestone != "" && in.Milestone != "none" { // a plain record names no stage
		msg += " · 단계: " + stageLabel(in.Milestone)
		if !in.MilestoneCertain {
			msg += " (AI 추정)"
		}
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
	msg := cleanName(filepath.Base(real)) + " · 지금 단계: " + stageLabel(root.Stage)
	if root.LastRecordID == "" {
		msg += " · 아직 기록이 없어요"
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
	folders := make([]string, 0, len(in.Folders))
	for _, f := range in.Folders {
		if !filepath.IsAbs(f) {
			f = filepath.Join(e.ProjectDir, f)
		}
		folders = append(folders, f)
	}
	if _, err := inbox.RequestImport(ctx, e.Inbox, "import", folders); err != nil {
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
	e.goSafe(func() {
		t := e.signupTiming()
		wctx, cancel := context.WithTimeout(e.ctxBase(), 11*time.Minute)
		defer cancel()
		if pairing.Wait(wctx, e.Pairing, sess, t.pairPoll) != nil {
			return
		}
		sctx, scancel := context.WithTimeout(e.ctxBase(), t.total)
		defer scancel()
		// signup step 5: this project (current) + up to 4 idea-looking siblings, all off but the first.
		// Posted even when empty, so the browser does not wait for a list that never comes.
		id := e.postSignupList(sctx)
		watchSignup(sctx, t, e.pollOnce, e.tickOnce, func() bool { return e.signupDone(id) })
	})
	return msgPairingOpened, false
}

// background runs inbox → uploads → GitHub → receipts after a tool answers, one run at a time.
func (e *Engine) background() {
	if !e.bg.TryLock() {
		return
	}
	if !e.goSafe(func() {
		defer e.bg.Unlock()
		ctx, cancel := context.WithTimeout(e.ctxBase(), backgroundBudget)
		defer cancel()
		e.Tick(ctx)
	}) {
		e.bg.Unlock()
	}
}

// Tick is one round of background work (exported for tests and the session-start path).
func (e *Engine) Tick(ctx context.Context) {
	e.inboxRound(ctx)
	e.resumeImport()
	record.Flush(ctx, e.Record)
	_, _ = record.SyncAnchors(ctx, e.Record)
	_ = repo.RetryStorageLink(ctx, e.Repo)
	_, _ = repo.PushOutbox(ctx, e.Repo)
}

// inboxRound sends pending approval requests and acts on the inbox; it returns the event count.
func (e *Engine) inboxRound(ctx context.Context) int {
	inbox.SendPending(ctx, e.Inbox)
	events, err := inbox.Process(ctx, e.Inbox)
	if err != nil {
		return 0
	}
	for _, ev := range events {
		if ev.Kind == "connect_github" && e.connecting.CompareAndSwap(false, true) { // one GitHub login at a time
			if !e.goSafe(func() {
				defer e.connecting.Store(false)
				cctx, cancel := context.WithTimeout(e.ctxBase(), 16*time.Minute)
				defer cancel()
				_ = repo.Connect(cctx, e.Repo)
				_, _ = repo.PushOutbox(cctx, e.Repo) // the token may be saved even if the link upload failed
			}) {
				e.connecting.Store(false)
			}
		}
		if paths := firstImportPaths(ev); len(paths) > 0 {
			if record.StartImport(e.Record, paths) != nil {
				record.Journal(e.StateDir, "import_not_saved")
			}
			e.resumeImport()
		}
	}
	return len(events)
}

// resumeImport runs the saved signup first import (new or interrupted), one at a time. The import
// journals its own skips and stops; what is left resumes on a later round.
func (e *Engine) resumeImport() {
	if !record.ImportPending(e.Record) || !e.importing.CompareAndSwap(false, true) {
		return
	}
	if !e.goSafe(func() {
		defer e.importing.Store(false)
		ictx, cancel := context.WithTimeout(e.ctxBase(), importBudget)
		defer cancel()
		_, _ = record.ResumeImport(ictx, e.Record, record.ImportLimit)
	}) {
		e.importing.Store(false)
	}
}

func isOTS(err error) bool { return errors.Is(err, ots.ErrTooFewReceipts) }
