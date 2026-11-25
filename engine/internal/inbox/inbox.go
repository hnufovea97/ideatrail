// Package inbox handles approval requests and the engine inbox (spec §4 kind 7/10/11). The AI can
// only ASK (request_import); folders are registered only when the user's dashboard answers with an
// Auth-mode message sealed by the pinned account key AND the answer matches a request this engine
// made itself, for folders it listed itself.
package inbox

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"

	"github.com/cloudflare/circl/kem"

	"ideatrail/engine/internal/api"
	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/pathguard"
	"ideatrail/engine/internal/state"
)

const (
	MaxOpen      = 3
	MaxFolders   = 5 // per approval request; signup: the project + up to MaxFolders-1 suggestions
	approvalTTL  = 7 * 24 * time.Hour
	connectTTL   = 10 * time.Minute
	approvalKeep = 30 * 24 * time.Hour // closed requests are forgotten after this
	maxListFiles = 5000
)

var (
	ErrTooMany   = errors.New("too many requests waiting for approval")
	ErrBadFolder = errors.New("folder not allowed")
	ErrNotPaired = errors.New("engine is not linked to an account yet")
)

// Deps are injected for tests.
type Deps struct {
	API      *api.Client
	Keys     *keys.Keys
	StateDir string
	Now      func() time.Time
	// OnlyUpdate: handle nothing but the dashboard's answer to an update request; every other
	// message stays in the inbox untouched (not read as seen, not deleted) for a later round.
	OnlyUpdate bool
}

func (d Deps) now() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

// RequestImport asks the user (on the dashboard) to approve recording these folders.
// kind: "import" | "add_folder" | "signup_select".
func RequestImport(ctx context.Context, d Deps, kind string, folders []string) (string, error) {
	if kind != "import" && kind != "add_folder" && kind != "signup_select" {
		return "", ErrBadFolder
	}
	st, err := state.Read(d.StateDir)
	if err != nil {
		return "", err
	}
	if st.UserID == "" || st.AccountPub == "" {
		return "", ErrNotPaired
	}
	if openApprovals(st, d.now()) >= MaxOpen {
		return "", ErrTooMany
	}
	// signup_select lists are chosen by the engine itself (the project first, then suggestions):
	// unsafe entries are left out instead of failing, the project stays even if already recorded
	// (marked current), and an empty list is still posted so the browser's step 5 never waits for
	// nothing (spec §15 M4).
	signup := kind == "signup_select"
	var real []string
	summary := []map[string]any{}
	seen := map[string]bool{}
	current := ""
	for i, f := range folders {
		if err := pathguard.ValidateFolder(f, d.StateDir); err != nil {
			if signup {
				continue
			}
			return "", ErrBadFolder
		}
		r, err := filepath.EvalSymlinks(f)
		if err != nil { // gone or changed since the check: never list an unresolved path
			if signup {
				continue
			}
			return "", ErrBadFolder
		}
		if signup && i == 0 {
			current = r
		}
		if _, taken := st.Folders[r]; (taken && r != current) || seen[r] {
			continue
		}
		seen[r] = true
		real = append(real, r)
		item := map[string]any{"path": r, "name": filepath.Base(r), "files": countFiles(r)}
		if signup {
			item["current"] = r == current
		}
		summary = append(summary, item)
	}
	if (len(real) == 0 && !signup) || len(real) > MaxFolders {
		return "", ErrBadFolder
	}
	plain, err := json.Marshal(map[string]any{"v": 1, "folders": summary})
	if err != nil {
		return "", err
	}
	sealKind := ic.KindApprovalSummary
	if kind == "signup_select" {
		sealKind = ic.KindFolderSuggestions
	}
	return submit(ctx, d, st, state.Approval{Kind: kind, Folders: real}, sealKind, plain)
}

// RequestUpdate asks the user (on the dashboard) to approve a new engine version. It lists what
// changed in plain words; it never lists folders and an answer can never register one.
func RequestUpdate(ctx context.Context, d Deps, from, to string, changes []string) (string, error) {
	st, err := state.Read(d.StateDir)
	if err != nil {
		return "", err
	}
	if st.UserID == "" || st.AccountPub == "" {
		return "", ErrNotPaired
	}
	// no MaxOpen check: the engine stays locked until this request is answered
	if changes == nil {
		changes = []string{}
	}
	plain, err := json.Marshal(map[string]any{"v": 1, "update": map[string]any{"from": from, "to": to, "changes": changes}})
	if err != nil {
		return "", err
	}
	return submit(ctx, d, st, state.Approval{Kind: "update", Version: to}, ic.KindApprovalSummary, plain)
}

// submit seals the summary to the account key, signs the request with the next appr_seq, records
// it in state (a.Kind, a.Folders and a.Version come from the caller) and sends it.
func submit(ctx context.Context, d Deps, st *state.State, a state.Approval, sealKind ic.Kind, plain []byte) (string, error) {
	kind := a.Kind
	akRaw, _ := ic.UnB64(st.AccountPub)
	ak, err := ic.ParseKEMPublic(akRaw)
	if err != nil {
		return "", err
	}
	approvalID, err := ic.NewID(randReader)
	if err != nil {
		return "", err
	}
	sealed, err := ic.Seal(sealKind, ak, ic.AAD{UserID: st.UserID, RootID: approvalID, Version: "0"}, plain)
	if err != nil {
		return "", err
	}
	var body []byte
	err = state.With(d.StateDir, func(s *state.State) error {
		prune(s, d.now())
		if kind != "update" && openApprovals(s, d.now()) >= MaxOpen { // re-check under the lock; an update request is never refused here
			return ErrTooMany
		}
		seq, err := s.ApprSeq.Next()
		if err != nil {
			return err
		}
		msg, err := ic.Approval{UserID: s.UserID, ApprovalID: approvalID, Kind: kind, SummarySealed: sealed, ApprSeq: seq}.Message()
		if err != nil {
			return err
		}
		sig, err := ic.Sign(d.Keys.Sign, msg)
		if err != nil {
			return err
		}
		body, err = json.Marshal(map[string]any{"approval_id": approvalID, "kind": kind, "summary": ic.B64(sealed),
			"appr_seq": strconv.FormatUint(seq, 10), "engine_sig": sig})
		if err != nil {
			return err
		}
		if s.Approvals == nil {
			s.Approvals = map[string]state.Approval{}
		}
		a.CreatedAt, a.Body, a.Seq = ic.FormatTime(d.now()), string(body), seq
		s.Approvals[approvalID] = a
		return nil
	})
	if err != nil {
		return "", err
	}
	SendPending(ctx, d)
	return approvalID, nil
}

// SendPending (re)sends approval requests the server has not accepted yet (same appr_seq), in
// appr_seq order. A transient failure stops the round (order kept); a permanent refusal closes
// that request so it cannot hold the open-request limit forever.
func SendPending(ctx context.Context, d Deps) {
	st, err := state.Read(d.StateDir)
	if err != nil {
		return
	}
	type pend struct {
		id string
		a  state.Approval
	}
	var list []pend
	for id, a := range st.Approvals {
		if a.Body != "" && !a.Done && !expired(a, d.now()) {
			list = append(list, pend{id, a})
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].a.Seq < list[j].a.Seq })
	for _, p := range list {
		err := d.API.Do(ctx, "POST", "/v1/approvals", json.RawMessage(p.a.Body), nil)
		var apiErr *api.Error
		permanent := errors.As(err, &apiErr) && !apiErr.Retryable()
		if err != nil && !permanent {
			return
		}
		_ = state.With(d.StateDir, func(s *state.State) error {
			x, ok := s.Approvals[p.id]
			if !ok {
				return nil
			}
			x.Body = ""
			x.Done = x.Done || permanent
			s.Approvals[p.id] = x
			return nil
		})
	}
}

// openApprovals counts requests still waiting for an answer.
func openApprovals(s *state.State, now time.Time) int {
	n := 0
	for _, a := range s.Approvals {
		if !a.Done && !expired(a, now) {
			n++
		}
	}
	return n
}

// prune closes expired requests and forgets closed ones after approvalKeep.
func prune(s *state.State, now time.Time) {
	for id, a := range s.Approvals {
		if !a.Done && expired(a, now) {
			a.Done, a.Body = true, ""
			s.Approvals[id] = a
		}
		if t, err := time.Parse(time.RFC3339, a.CreatedAt); a.Done && (err != nil || now.Sub(t) > approvalKeep) {
			delete(s.Approvals, id)
		}
	}
}

// Event is what the MCP layer acts on after processing the inbox.
type Event struct {
	Kind    string // "folders_registered" | "rejected" | "connect_github" | "update_approved" | "update_rejected"
	Folders int
	Paths   []string // folders_registered: the folders newly registered by this message
	Signup  bool     // folders_registered from the signup step 5 choice (first import applies)
}

type message struct {
	MsgID     string `json:"msg_id"`
	Sealed    string `json:"sealed"`
	CreatedAt string `json:"created_at"`
}

type payload struct {
	V          int      `json:"v"`
	Type       string   `json:"type"`
	ApprovalID string   `json:"approval_id"`
	Decision   string   `json:"decision"`
	Folders    []string `json:"folders"`
	IssuedAt   string   `json:"issued_at"`
}

// Process reads the inbox, acts only on verified messages that match this engine's own requests,
// and deletes every message it has looked at.
func Process(ctx context.Context, d Deps) ([]Event, error) {
	st, err := state.Read(d.StateDir)
	if err != nil {
		return nil, err
	}
	if st.UserID == "" || st.AccountPub == "" {
		return nil, ErrNotPaired
	}
	akRaw, err := ic.UnB64(st.AccountPub)
	if err != nil {
		return nil, err
	}
	akPub, err := ic.ParseKEMPublic(akRaw)
	if err != nil {
		return nil, err
	}
	var out struct {
		Messages []message `json:"messages"`
	}
	if err := d.API.Do(ctx, "GET", "/v1/inbox", nil, &out); err != nil {
		return nil, err
	}
	_ = state.With(d.StateDir, func(s *state.State) error { prune(s, d.now()); return nil })
	var events []Event
	for _, m := range out.Messages {
		ev, ok, retry := handle(d, akPub, m)
		if ok {
			events = append(events, ev)
		}
		if validID(m.MsgID) && !retry { // keep it for next time if our own state could not be saved
			_ = d.API.Do(ctx, "DELETE", "/v1/inbox/"+m.MsgID, nil, nil)
		}
	}
	return events, nil
}

// handle returns the event, whether there is one, and whether the message should be kept for a
// retry (a local failure, not a problem with the message).
func handle(d Deps, pub kem.PublicKey, m message) (Event, bool, bool) {
	if !validID(m.MsgID) {
		return Event{}, false, false
	}
	st, err := state.Read(d.StateDir) // fresh: approvals may have been added since the inbox call
	if err != nil {
		return Event{}, false, true
	}
	sealed, err := ic.UnB64(m.Sealed)
	if err != nil {
		return Event{}, false, false
	}
	// The approval id is part of the AAD; try "" and each of our own open approvals.
	candidates := []string{""}
	for id, a := range st.Approvals {
		if !a.Done && !expired(a, d.now()) {
			candidates = append(candidates, id)
		}
	}
	var p payload
	var boundTo string
	opened := false
	for _, root := range candidates {
		pt, err := ic.OpenAuth(ic.KindEngineInbox, d.Keys.KEMPriv, pub, ic.AAD{UserID: st.UserID, RootID: root, RecordID: m.MsgID}, sealed)
		if err != nil {
			continue
		}
		if json.Unmarshal(pt, &p) != nil {
			return Event{}, false, false
		}
		boundTo, opened = root, true
		break
	}
	if !opened || p.V != 1 {
		return Event{}, false, false
	}
	issued, err := time.Parse(time.RFC3339, p.IssuedAt)
	if err != nil || d.now().Sub(issued) > approvalTTL || issued.After(d.now().Add(5*time.Minute)) {
		return Event{}, false, false
	}
	var ev Event
	ok := false
	err = state.With(d.StateDir, func(s *state.State) error {
		if d.OnlyUpdate && !isUpdateAnswer(s, p, boundTo, d.now()) {
			return errKeep
		}
		if !s.RememberMsgID(m.MsgID) {
			return errReplay
		}
		switch p.Type {
		case "connect_github":
			if boundTo == "" && d.now().Sub(issued) <= connectTTL {
				ev, ok = Event{Kind: "connect_github"}, true
			}
		case "approval_result", "select_folders":
			a, exists := s.Approvals[p.ApprovalID]
			if !exists || a.Done || p.ApprovalID != boundTo || expired(a, d.now()) {
				return nil
			}
			if a.Kind == "update" {
				if p.Type != "approval_result" {
					return nil // an update answer never selects folders
				}
				a.Done = true
				s.Approvals[p.ApprovalID] = a
				ev, ok = answerUpdate(s, a, p.Decision == "approved")
				return nil
			}
			// signup lists close only by the browser's choice; an approval_result would register
			// every folder offered
			if p.Type == "approval_result" && a.Kind == "signup_select" {
				return nil
			}
			chosen := a.Folders // approval_result: everything this engine asked about
			if p.Type == "select_folders" {
				if a.Kind != "signup_select" {
					return nil
				}
				chosen = intersect(a.Folders, p.Folders) // never folders the message invents
			}
			a.Done = true
			s.Approvals[p.ApprovalID] = a
			if p.Type == "approval_result" && p.Decision != "approved" {
				ev, ok = Event{Kind: "rejected"}, true
				return nil
			}
			n := 0
			var added []string
			for _, f := range chosen {
				if pathguard.ValidateFolder(f, d.StateDir) != nil { // re-check at registration time
					continue
				}
				if s.Folders == nil {
					s.Folders = map[string]string{}
				}
				if _, taken := s.Folders[f]; taken {
					continue
				}
				id, err := ic.NewID(randReader)
				if err != nil {
					return err
				}
				s.Folders[f] = id
				added = append(added, f)
				n++
			}
			ev, ok = Event{Kind: "folders_registered", Folders: n, Paths: added, Signup: a.Kind == "signup_select"}, true
		}
		return nil
	})
	if errors.Is(err, errReplay) {
		return Event{}, false, false
	}
	if errors.Is(err, errKeep) {
		return Event{}, false, true
	}
	if err != nil {
		return Event{}, false, true
	}
	return ev, ok, false
}

// answerUpdate applies the dashboard's answer to a new engine version. It never touches folders.
func answerUpdate(s *state.State, a state.Approval, approved bool) (Event, bool) {
	waiting := s.UpdatePending != nil && s.UpdatePending.Version == a.Version
	if approved {
		s.ApprovedVersion = a.Version
		if waiting {
			s.UpdatePending = nil
		}
		return Event{Kind: "update_approved"}, true
	}
	if waiting {
		s.UpdatePending.Rejected = true
	}
	return Event{Kind: "update_rejected"}, true
}

var (
	errReplay = errors.New("replayed message")
	errKeep   = errors.New("message kept for later")
)

// isUpdateAnswer: an approval_result bound to one of this engine's own open update requests.
func isUpdateAnswer(s *state.State, p payload, boundTo string, now time.Time) bool {
	a, ok := s.Approvals[p.ApprovalID]
	return p.Type == "approval_result" && ok && a.Kind == "update" && !a.Done && p.ApprovalID == boundTo && !expired(a, now)
}

// Expired reports whether an approval request is older than the approval lifetime.
func Expired(a state.Approval, now time.Time) bool { return expired(a, now) }

func expired(a state.Approval, now time.Time) bool {
	t, err := time.Parse(time.RFC3339, a.CreatedAt)
	return err != nil || now.Sub(t) > approvalTTL
}

func intersect(asked, chosen []string) []string {
	set := map[string]bool{}
	for _, c := range chosen {
		set[c] = true
	}
	var out []string
	for _, a := range asked {
		if set[a] {
			out = append(out, a)
		}
	}
	return out
}

func validID(s string) bool {
	if len(s) != 26 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z')) || c == 'i' || c == 'l' || c == 'o' || c == 'u' {
			return false
		}
	}
	return true
}

// countFiles gives the approval screen a rough size (bounded walk).
func countFiles(dir string) int {
	n := 0
	_ = filepath.WalkDir(dir, func(p string, e os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if n >= maxListFiles {
			return filepath.SkipAll
		}
		if e.IsDir() && (e.Name() == ".git" || e.Name() == "node_modules") {
			return filepath.SkipDir
		}
		if e.Type().IsRegular() {
			n++
		}
		return nil
	})
	return n
}
