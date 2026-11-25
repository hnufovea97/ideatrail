package mcpserver

import (
	"context"
	"errors"
	"time"

	"ideatrail/engine/internal/inbox"
	"ideatrail/engine/internal/record"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/update"
)

// While a new engine version waits for the user's approval on the dashboard, the tools answer one
// fixed line and do nothing else. The state is read on every call, so the answer that arrives
// through the inbox unlocks the tools without a restart.

// updateBlock returns the waiting line when a new version is not approved yet.
func (e *Engine) updateBlock() (string, bool) {
	line := update.BlockLine(update.Pending(e.StateDir))
	return line, line != ""
}

// blockedTool answers the waiting line and keeps the inbox round going so the approval can arrive.
func (e *Engine) blockedTool(line string) string {
	e.updateRound()
	return line
}

// updateRound runs only the inbox round (no recording, uploads or GitHub work), one at a time.
func (e *Engine) updateRound() {
	if !e.bg.TryLock() {
		return
	}
	if !e.goSafe(func() {
		defer e.bg.Unlock()
		ctx, cancel := context.WithTimeout(e.ctxBase(), backgroundBudget)
		defer cancel()
		e.ensureUpdateRequest(ctx, false)
		e.inboxRound(ctx)
	}) {
		e.bg.Unlock()
	}
}

// StartUpdateGate creates the approval request once when this run starts with a new version
// waiting (no request yet, or the earlier one was rejected or went stale).
func (e *Engine) StartUpdateGate(ctx context.Context) {
	if !e.UpdateGate.Pending {
		return
	}
	e.ensureUpdateRequest(ctx, true)
}

// ensureUpdateRequest sends the dashboard request for the waiting version. On a later round
// (restart false) it only fills a missing request; a rejection is retried at the next start.
func (e *Engine) ensureUpdateRequest(ctx context.Context, restart bool) {
	e.updateMu.Lock()
	defer e.updateMu.Unlock()
	st, err := state.Read(e.StateDir)
	if err != nil || st.UpdatePending == nil || st.UserID == "" || st.AccountPub == "" {
		return
	}
	p := st.UpdatePending
	if p.ApprovalID != "" && !(restart && (p.Rejected || !openApproval(st, p.ApprovalID))) {
		return
	}
	if p.Rejected && !restart {
		return
	}
	id, err := inbox.RequestUpdate(ctx, e.Inbox, st.ApprovedVersion, p.Version, update.Changes(st.ApprovedVersion, p.Version))
	if err != nil {
		if !errors.Is(err, inbox.ErrTooMany) && !errors.Is(err, inbox.ErrNotPaired) {
			record.Journal(e.StateDir, "update_request_failed")
		}
		return
	}
	_ = state.With(e.StateDir, func(s *state.State) error {
		if s.UpdatePending != nil && s.UpdatePending.Version == p.Version {
			s.UpdatePending.ApprovalID, s.UpdatePending.Rejected = id, false
		}
		return nil
	})
}

// openApproval reports whether the request is still waiting for an answer.
func openApproval(st *state.State, id string) bool {
	a, ok := st.Approvals[id]
	if !ok || a.Done {
		return false
	}
	t, err := time.Parse(time.RFC3339, a.CreatedAt)
	return err == nil && time.Since(t) <= 7*24*time.Hour
}
