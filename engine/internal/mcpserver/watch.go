package mcpserver

import (
	"context"
	"time"

	"ideatrail/engine/internal/inbox"
	"ideatrail/engine/internal/record"
	"ideatrail/engine/internal/state"
)

// signupTiming paces the signup watcher. Engine-signed routes are not under the server's per-IP
// limit (10/min, unauthenticated routes only) but the inbox read is kept light anyway: one
// GET /v1/inbox every 15s plus one full round a minute is about 6 requests a minute.
type signupTiming struct {
	poll     time.Duration // inbox only (SendPending + Process)
	full     time.Duration // full round: uploads, anchors, GitHub
	total    time.Duration // watch at most this long after pairing
	pairPoll time.Duration // pairing handoff poll
	retry    time.Duration // first wait before re-asking for the signup list
}

var defaultSignupTiming = signupTiming{poll: 15 * time.Second, full: 60 * time.Second, total: 30 * time.Minute,
	pairPoll: 3 * time.Second, retry: 2 * time.Second}

const signupListTries = 3

func (e *Engine) signupTiming() signupTiming {
	if e.timing == (signupTiming{}) {
		return defaultSignupTiming
	}
	return e.timing
}

// watchSignup runs until ctx ends or done reports true. During signup the person is in the
// browser, so no MCP tool call drives background work: poll reads the inbox at the fast cadence
// (connect_github, select_folders) and full runs after an event and on the slow cadence.
func watchSignup(ctx context.Context, t signupTiming, poll func(context.Context) int, full func(context.Context), done func() bool) {
	pollT := time.NewTicker(t.poll)
	defer pollT.Stop()
	fullT := time.NewTicker(t.full)
	defer fullT.Stop()
	for !done() {
		select {
		case <-ctx.Done():
			return
		case <-pollT.C:
			if poll(ctx) > 0 {
				full(ctx)
			}
		case <-fullT.C:
			full(ctx)
		}
	}
}

// signupDone: the signup list was answered (or closed) and no GitHub login is running. Without a
// posted list the watcher runs for its full time.
func (e *Engine) signupDone(approvalID string) bool {
	if approvalID == "" || e.connecting.Load() {
		return false
	}
	st, err := state.Read(e.StateDir)
	return err == nil && st.Approvals[approvalID].Done
}

// postSignupList posts signup step 5's list, retrying a few times with backoff; a final failure is
// journaled (fixed line). Returns the approval id, or "" when it could not be posted.
func (e *Engine) postSignupList(ctx context.Context) string {
	home, err := e.home()
	if err != nil {
		home = "" // no home: no suggestions, the project alone
	}
	folders := signupFolders(e.ProjectDir, e.StateDir, home)
	wait := e.signupTiming().retry
	for try := 1; ; try++ {
		id, err := inbox.RequestImport(ctx, e.Inbox, "signup_select", folders)
		if err == nil {
			return id
		}
		if try == signupListTries || sleepCtx(ctx, wait) != nil {
			record.Journal(e.StateDir, "signup_list_failed")
			return ""
		}
		wait *= 2
	}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// tickOnce is one full background round, skipped if one is already running (same lock as background()).
func (e *Engine) tickOnce(ctx context.Context) {
	if !e.bg.TryLock() {
		return
	}
	defer e.bg.Unlock()
	tctx, cancel := context.WithTimeout(ctx, backgroundBudget)
	defer cancel()
	e.Tick(tctx)
}

// pollOnce is the inbox-only round; it returns how many events it acted on.
func (e *Engine) pollOnce(ctx context.Context) int {
	if !e.bg.TryLock() {
		return 0
	}
	defer e.bg.Unlock()
	tctx, cancel := context.WithTimeout(ctx, backgroundBudget)
	defer cancel()
	return e.inboxRound(tctx)
}
