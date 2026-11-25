package mcpserver

import (
	"context"
	"errors"
	"time"

	"ideatrail/engine/internal/config"
	"ideatrail/engine/internal/inbox"
	"ideatrail/engine/internal/record"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/update"
)

// While a new engine version waits for the user's approval on the dashboard, the tools answer one
// fixed line and do nothing else. The state is read on every call, so the answer that arrives
// through the inbox unlocks the tools without a restart.

// updateBlock returns the waiting line unless the user approved exactly the version this process
// runs. The approved version is read on every call, so an older binary that started later (and
// cleared nothing) can never unlock a newer one, and the dashboard's answer unlocks without a restart.
func (e *Engine) updateBlock() (string, bool) {
	if config.Dev() {
		return "", false
	}
	st, err := state.Read(e.StateDir)
	if err != nil {
		return update.WaitingLine(e.Version), true // unreadable state: fail closed
	}
	if st.UserID == "" || st.ApprovedVersion == "" || st.ApprovedVersion == e.Version {
		return "", false
	}
	if st.UpdatePending == nil || st.UpdatePending.Version != e.Version {
		// not approved and no request for this version in state: make it again
		_, _ = update.Check(e.StateDir, e.Version)
		if st, err = state.Read(e.StateDir); err != nil {
			return update.WaitingLine(e.Version), true
		}
	}
	if st.UpdatePending != nil && st.UpdatePending.Version == e.Version {
		return update.BlockLine(st.UpdatePending), true
	}
	return update.WaitingLine(e.Version), true
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
	return ok && !a.Done && !inbox.Expired(a, time.Now())
}
