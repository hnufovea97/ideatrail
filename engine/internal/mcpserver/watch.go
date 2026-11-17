package mcpserver

import (
	"context"
	"time"
)

const (
	signupWatchFor   = 30 * time.Minute
	signupWatchEvery = 5 * time.Second
)

// watchSignup runs tick every `every` until ctx ends. During signup the person is in the browser,
// so no MCP tool call drives background work; this picks up connect_github and select_folders.
func watchSignup(ctx context.Context, every time.Duration, tick func(context.Context)) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			tick(ctx)
		}
	}
}

// tickOnce is one background round, skipped if one is already running (same lock as background()).
func (e *Engine) tickOnce(ctx context.Context) {
	if !e.bg.TryLock() {
		return
	}
	defer e.bg.Unlock()
	tctx, cancel := context.WithTimeout(ctx, backgroundBudget)
	defer cancel()
	e.Tick(tctx)
}
