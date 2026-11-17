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
	approvalTTL  = 7 * 24 * time.Hour
	connectTTL   = 10 * time.Minute
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
	open := 0
	for _, a := range st.Approvals {
		if !a.Done {
			open++
		}
	}
	if open >= MaxOpen {
		return "", ErrTooMany
	}
	var real []string
	var summary []map[string]any
	for _, f := range folders {
		if err := pathguard.ValidateFolder(f, d.StateDir); err != nil {
			return "", ErrBadFolder
		}
		r, _ := filepath.EvalSymlinks(f)
		if _, taken := st.Folders[r]; taken {
			continue
		}
		real = append(real, r)
		summary = append(summary, map[string]any{"path": r, "name": filepath.Base(r), "files": countFiles(r)})
	}
	if len(real) == 0 || len(real) > 5 {
		return "", ErrBadFolder
	}
	plain, err := json.Marshal(map[string]any{"v": 1, "folders": summary})
	if err != nil {
		return "", err
	}
	akRaw, _ := ic.UnB64(st.AccountPub)
	ak, err := ic.ParseKEMPublic(akRaw)
	if err != nil {
		return "", err
	}
	approvalID, err := ic.NewID(randReader)
	if err != nil {
		return "", err
	}
	sealKind := ic.KindApprovalSummary
	if kind == "signup_select" {
		sealKind = ic.KindFolderSuggestions
	}
	sealed, err := ic.Seal(sealKind, ak, ic.AAD{UserID: st.UserID, RootID: approvalID, Version: "0"}, plain)
	if err != nil {
		return "", err
	}
	var body []byte
	err = state.With(d.StateDir, func(s *state.State) error {
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
		s.Approvals[approvalID] = state.Approval{Kind: kind, Folders: real, CreatedAt: ic.FormatTime(d.now()), Body: string(body)}
		return nil
	})
	if err != nil {
		return "", err
	}
	SendPending(ctx, d)
	return approvalID, nil
}

// SendPending (re)sends approval requests the server has not accepted yet (same appr_seq).
func SendPending(ctx context.Context, d Deps) {
	st, err := state.Read(d.StateDir)
	if err != nil {
		return
	}
	for id, a := range st.Approvals {
		if a.Body == "" || a.Done {
			continue
		}
		if err := d.API.Do(ctx, "POST", "/v1/approvals", json.RawMessage(a.Body), nil); err != nil {
			continue
		}
		_ = state.With(d.StateDir, func(s *state.State) error {
			x := s.Approvals[id]
			x.Body = ""
			s.Approvals[id] = x
			return nil
		})
	}
}

// Event is what the MCP layer acts on after processing the inbox.
type Event struct {
	Kind    string // "folders_registered" | "rejected" | "connect_github"
	Folders int
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
	var events []Event
	for _, m := range out.Messages {
		if ev, ok := handle(d, st, akPub, m); ok {
			events = append(events, ev)
		}
		if validID(m.MsgID) {
			_ = d.API.Do(ctx, "DELETE", "/v1/inbox/"+m.MsgID, nil, nil)
		}
	}
	return events, nil
}

func handle(d Deps, st *state.State, pub kem.PublicKey, m message) (Event, bool) {
	if !validID(m.MsgID) {
		return Event{}, false
	}
	sealed, err := ic.UnB64(m.Sealed)
	if err != nil {
		return Event{}, false
	}
	// The approval id is part of the AAD; try "-" and each of our own open approvals.
	candidates := []string{""}
	for id := range st.Approvals {
		candidates = append(candidates, id)
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
			return Event{}, false
		}
		boundTo, opened = root, true
		break
	}
	if !opened || p.V != 1 {
		return Event{}, false
	}
	issued, err := time.Parse(time.RFC3339, p.IssuedAt)
	if err != nil || d.now().Sub(issued) > approvalTTL || issued.After(d.now().Add(5*time.Minute)) {
		return Event{}, false
	}
	var ev Event
	ok := false
	err = state.With(d.StateDir, func(s *state.State) error {
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
				n++
			}
			ev, ok = Event{Kind: "folders_registered", Folders: n}, true
		}
		return nil
	})
	if err != nil {
		return Event{}, false
	}
	return ev, ok
}

var errReplay = errors.New("replayed message")

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
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'z') || c == 'i' || c == 'l' || c == 'o' || c == 'u' {
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
