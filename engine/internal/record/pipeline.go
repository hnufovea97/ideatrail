package record

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"

	"github.com/cloudflare/circl/kem"

	"ideatrail/engine/internal/api"
	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/home"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/ots"
	"ideatrail/engine/internal/pathguard"
	"ideatrail/engine/internal/state"
)

var (
	ErrNotPaired     = errors.New("engine is not linked to an account yet")
	ErrNotRegistered = errors.New("this folder is not registered with ideatrail")
	ErrBadInput      = errors.New("record input out of range")
)

// Limits match the MCP tool schema (plugin draft §4).
const (
	maxNote     = 2000 // characters (schema says 400; leave room for non-Latin text)
	maxTags     = 5
	maxTagLen   = 20
	maxRoutines = 7
)

var (
	milestones   = map[string]bool{"": true, "none": true, "idea": true, "plan_decided": true, "mvp_done": true, "feature_done": true, "paused": true}
	routineSlots = map[string]bool{"problem": true, "audience": true, "not_doing": true, "decision_reason": true, "first_run": true, "feedback": true, "changed_by_feedback": true}
)

func (in Input) validate() error {
	if len([]rune(in.Note)) > maxNote || !milestones[in.Milestone] || len(in.Tags) > maxTags || len(in.Routine) > maxRoutines {
		return ErrBadInput
	}
	for _, t := range in.Tags {
		if len([]rune(t)) > maxTagLen || t == "" {
			return ErrBadInput
		}
	}
	for _, r := range in.Routine {
		if !routineSlots[r.Slot] {
			return ErrBadInput
		}
	}
	return nil
}

const maxMetaPlain = 4000 // sealed list_meta must stay under the server's 8KB cap

// Deps are the pipeline's collaborators (injected for tests).
type Deps struct {
	API       *api.Client
	Keys      *keys.Keys
	StateDir  string
	ProofDir  string // local second copy, default ~/ideatrail-증명
	OutboxDir string // GitHub queue, default <engine dir>-outbox
	Calendars []string
	OTSHTTP   *http.Client
	Now       func() time.Time
}

// Routine is one routine-check slot (plugin draft §4).
type Routine struct {
	Slot      string `json:"slot"`
	Estimated bool   `json:"estimated,omitempty"`
}

// Input is what the record tool passes.
type Input struct {
	Paths            []string
	Note             string
	Milestone        string
	MilestoneCertain bool
	Routine          []Routine
	Tags             []string
	Import           bool // signup first import: uses the server's import allowance, not the hourly cap
}

// Result is safe to show: ids, a status code and the idea title — no paths or secrets.
type Result struct {
	RecordID string
	RootID   string
	Title    string
	Status   string // "sent", "queued", "blocked"
	Warning  string // e.g. "proof_dir_synced"
}

func (d *Deps) now() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

// guard builds the path guard from registered folders; engine and queue folders are never readable.
func (d *Deps) guard(st *state.State) *pathguard.Guard {
	g := &pathguard.Guard{
		Deny:      []string{d.StateDir, d.ProofDir, d.OutboxDir},
		DenyFiles: []string{filepath.Join(d.StateDir, "engine.key"), filepath.Join(d.StateDir, "state.json")},
	}
	for p, root := range st.Folders {
		g.Folders = append(g.Folders, pathguard.Folder{Path: p, RootID: root})
	}
	sort.Slice(g.Folders, func(i, j int) bool { return len(g.Folders[i].Path) > len(g.Folders[j].Path) }) // deepest first
	return g
}

// Record fingerprints, anchors, seals, stores locally, queues for GitHub and uploads one record.
func Record(ctx context.Context, d Deps, in Input) (*Result, error) {
	if err := in.validate(); err != nil {
		return nil, err
	}
	st, err := state.Read(d.StateDir)
	if err != nil {
		return nil, err
	}
	if st.UserID == "" || st.AccountPub == "" {
		return nil, ErrNotPaired
	}
	sweepOrphansLocked(d)
	ak, err := accountKey(st.AccountPub)
	if err != nil {
		return nil, err
	}
	if countEntries(filepath.Join(d.StateDir, pendingDir)) >= MaxQueued || countEntries(d.OutboxDir) >= MaxQueued {
		return nil, ErrQueueFull
	}
	if len(st.Folders) == 0 {
		return nil, ErrNotRegistered
	}
	col, err := Collect(d.guard(st), in.Paths)
	if err != nil {
		return nil, err
	}
	var digest [32]byte = col.Commitment
	receipts, err := ots.Submit(ctx, d.OTSHTTP, d.Calendars, digest)
	if err != nil {
		return nil, err
	}
	recordID, err := ic.NewID(randReader)
	if err != nil {
		return nil, err
	}
	title := filepath.Base(col.Folder)
	recordedAt := ic.FormatTime(d.now())
	sealed, err := sealRecord(ak, st.UserID, col, recordID, title, recordedAt, in)
	if err != nil {
		return nil, err
	}

	res := &Result{RecordID: recordID, RootID: col.RootID, Title: title, Status: "queued"}
	if synced, _ := home.Synced(d.ProofDir); synced {
		res.Warning = "proof_dir_synced"
	}
	// One locked step: number, sign, then write pending body + GitHub queue + local copy, then
	// save state. Nothing is sent before all of it is on disk (crash-safe, spec §2). If the step
	// fails, the files it wrote are removed so no orphan reuses the (unconsumed) log_seq later.
	var written []string
	defer func() {
		if err != nil {
			for _, p := range written {
				_ = os.Remove(p)
			}
		}
	}()
	err = state.With(d.StateDir, func(s *state.State) error {
		if s.AccountPub != st.AccountPub {
			return errors.New("account changed")
		}
		seq, err := s.LogSeq.Next()
		if err != nil {
			return err
		}
		root := s.Roots[col.RootID]
		var parents []string
		if root.LastRecordID != "" {
			parents = []string{root.LastRecordID}
		}
		commitHex := hex.EncodeToString(col.Commitment[:])
		msg, err := ic.Record{UserID: s.UserID, RootID: col.RootID, RecordID: recordID, Parents: parents, CommitmentHex: commitHex,
			MetaSealed: sealed.meta, BodySealed: sealed.body, NonceSealed: sealed.nonce, LogSeq: seq, RecordedAt: recordedAt}.Message()
		if err != nil {
			return err
		}
		sig, err := ic.Sign(d.Keys.Sign, msg)
		if err != nil {
			return err
		}
		body, err := json.Marshal(uploadBody(recordID, col, parents, commitHex, recordedAt, seq, sig, sealed, receipts, in.Import))
		if err != nil {
			return err
		}
		pendingPath := filepath.Join(d.StateDir, pendingDir, recordID+".json")
		written = append(written, pendingPath)
		if err := writeJSON(pendingPath, pendingFile{Kind: "record", Path: "/v1/records", Body: body}); err != nil {
			return err
		}
		outboxPath, err := writeOutbox(d.OutboxDir, seq, recordID, sealed, bundle(recordID, commitHex, col.Manifest, receipts, recordedAt, d.Keys.EngineID, seq, sig, ic.B64(sealed.nonce)))
		written = append(written, outboxPath)
		if err != nil {
			return err
		}
		// local copy = GitHub bundle + plaintext nonce (nonce_sealed kept so a later repo update can be rebuilt)
		local := bundle(recordID, commitHex, col.Manifest, receipts, recordedAt, d.Keys.EngineID, seq, sig, ic.B64(sealed.nonce))
		local["nonce"] = hex.EncodeToString(col.Nonce)
		localPath := filepath.Join(d.ProofDir, recordID, "bundle.json")
		written = append(written, localPath)
		if err := writeJSON(localPath, local); err != nil {
			return err
		}
		if s.Roots == nil {
			s.Roots = map[string]state.Root{}
		}
		root.LastRecordID = recordID
		root.LastRecordAt = recordedAt
		if in.Milestone != "" && in.Milestone != "none" {
			root.Stage = in.Milestone
		}
		s.Roots[col.RootID] = root
		s.PendingUploads = append(s.PendingUploads, recordID)
		return journalLine(d.StateDir, map[string]string{"record_id": recordID, "commitment": commitHex, "log_seq": strconv.FormatUint(seq, 10), "status": "created"})
	})
	if err != nil {
		return nil, err
	}
	res.Status = Flush(ctx, d)
	return res, nil
}

type sealedParts struct{ meta, body, nonce, original []byte }

func sealRecord(ak kem.PublicKey, userID string, col *Collected, recordID, title, recordedAt string, in Input) (*sealedParts, error) {
	a := ic.AAD{UserID: userID, RootID: col.RootID, RecordID: recordID, Version: "0"}
	meta, err := metaJSON(title, in, col, recordedAt)
	if err != nil {
		return nil, err
	}
	bodyPlain, err := json.Marshal(map[string]any{"v": 1, "note": in.Note, "routine": in.Routine, "tags": in.Tags})
	if err != nil {
		return nil, err
	}
	var p sealedParts
	if p.meta, err = ic.Seal(ic.KindRecordMeta, ak, a, meta); err != nil {
		return nil, err
	}
	if p.body, err = ic.Seal(ic.KindRecordBody, ak, a, bodyPlain); err != nil {
		return nil, err
	}
	if p.nonce, err = ic.Seal(ic.KindNonce, ak, a, col.Nonce); err != nil {
		return nil, err
	}
	if col.Original != nil {
		if p.original, err = ic.Seal(ic.KindOriginal, ak, a, col.Original); err != nil {
			return nil, err
		}
	}
	return &p, nil
}

// metaJSON keeps the list view small: at most 20 files listed, then "more".
func metaJSON(title string, in Input, col *Collected, recordedAt string) ([]byte, error) {
	files := col.FileList()
	for limit := 20; ; limit /= 2 {
		shown := files
		if len(shown) > limit {
			shown = shown[:limit]
		}
		m := map[string]any{"v": 1, "title": title, "milestone": orNone(in.Milestone), "milestone_certain": in.MilestoneCertain,
			"files": shown, "more_files": len(files) - len(shown), "recorded_at": recordedAt,
			"tags": orEmpty(in.Tags), "routine": routineOrEmpty(in.Routine)} // list view needs these without GitHub (spec §15 M5a)
		b, err := json.Marshal(m)
		if err != nil || len(b) <= maxMetaPlain || limit == 0 {
			if len(b) > maxMetaPlain {
				return nil, errors.New("record metadata too large")
			}
			return b, err
		}
	}
}

func orNone(s string) string {
	if s == "" {
		return "none"
	}
	return s
}

// orEmpty keeps JSON arrays as [] (never null) so the dashboard reads one shape.
func orEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func routineOrEmpty(r []Routine) []Routine {
	if r == nil {
		return []Routine{}
	}
	return r
}

func accountKey(b64 string) (kem.PublicKey, error) {
	raw, err := ic.UnB64(b64)
	if err != nil {
		return nil, err
	}
	return ic.ParseKEMPublic(raw)
}

func hexSHA(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

func uploadBody(recordID string, col *Collected, parents []string, commitHex, recordedAt string, seq uint64, sig string, p *sealedParts, receipts []ots.Receipt, imported bool) map[string]any {
	otsList := make([]map[string]string, 0, len(receipts))
	for _, r := range receipts {
		otsList = append(otsList, map[string]string{"calendar": r.Calendar, "pending": ic.B64(r.Pending)})
	}
	if parents == nil {
		parents = []string{}
	}
	body := map[string]any{
		"record_id": recordID, "root_id": col.RootID, "parent_ids": parents, "commitment": commitHex, "manifest": col.Manifest,
		"recorded_at": recordedAt, "log_seq": strconv.FormatUint(seq, 10), "list_meta": ic.B64(p.meta),
		"body_hash": hexSHA(p.body), "nonce_hash": hexSHA(p.nonce), "engine_sig": sig, "ots": otsList,
	}
	if imported {
		body["import"] = true // stored in pending/ with the rest, so a retry sends the same bytes
	}
	return body
}

// bundle is the §12 bundle.json (GitHub form carries nonce_sealed; the local form carries the nonce).
func bundle(recordID, commitHex string, manifest bool, receipts []ots.Receipt, recordedAt, engineID string, seq uint64, sig, nonceSealed string) map[string]any {
	otsList := make([]map[string]any, 0, len(receipts))
	for _, r := range receipts {
		otsList = append(otsList, map[string]any{"calendar": r.Calendar, "pending": ic.B64(r.Pending), "complete": nil})
	}
	return map[string]any{"v": 1, "record_id": recordID, "hash_alg": "sha256-nonce-v1", "commitment": commitHex,
		"nonce_sealed": nonceSealed, "manifest": manifest, "ots": otsList, "recorded_at": recordedAt,
		"engine_id": engineID, "log_seq": strconv.FormatUint(seq, 10), "engine_sig": sig}
}

// writeOutbox queues the GitHub commit for this record (pushed by M3b; spec §9-7, §12).
func writeOutbox(dir string, seq uint64, recordID string, p *sealedParts, githubBundle map[string]any) (string, error) {
	b, err := json.Marshal(githubBundle)
	if err != nil {
		return "", err
	}
	files := map[string]string{
		"records/" + recordID + ".it1":        ic.B64(p.body),
		"proofs/" + recordID + "/bundle.json": ic.B64(b),
	}
	if p.original != nil {
		files["proofs/"+recordID+"/original.it1"] = ic.B64(p.original)
	}
	path := filepath.Join(dir, OutboxName(seq, recordID, false))
	return path, writeJSON(path, map[string]any{"v": 1, "kind": "record", "record_id": recordID, "log_seq": strconv.FormatUint(seq, 10), "files": files})
}

// OutboxName orders queue items by log_seq; a record's bundle update ("-1") always sorts after the
// record itself ("-0"), and writing the same update name again coalesces repeated updates.
func OutboxName(seq uint64, recordID string, update bool) string {
	n := strconv.FormatUint(seq, 10)
	for len(n) < 20 {
		n = "0" + n
	}
	suffix := "-0.json"
	if update {
		suffix = "-1.json"
	}
	return n + "-" + recordID + suffix
}
