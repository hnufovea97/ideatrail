// Package repo connects the engine to the user's GitHub and pushes the queued commits
// (spec §9-7, §12). Only the MCP process runs this; hooks never do.
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"ideatrail/engine/internal/api"
	ic "ideatrail/engine/internal/crypto"
	gh "ideatrail/engine/internal/github"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/state"
)

const (
	githubFile   = "ideatrail-github.json"
	outboxLock   = "outbox.lock"
	lockWait     = 3 * time.Minute
	maxItemBytes = 16 << 20
)

var (
	ErrNotConnected = errors.New("github not connected yet")
	ErrNotPaired    = errors.New("engine is not linked to an account yet")
)

// Deps are injected for tests.
type Deps struct {
	API        *api.Client
	Keys       *keys.Keys
	StateDir   string
	OutboxDir  string
	GitHubBase string // https://api.github.com
	Flow       *gh.DeviceFlow
	Sleep      func(context.Context, time.Duration) error
	Now        func() time.Time
}

type stored struct {
	Token string `json:"token"`
	gh.Repo
}

func (d Deps) now() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

// Connected reports whether a GitHub token and pinned repo are stored.
func Connected(d Deps) bool { _, err := load(d); return err == nil }

func load(d Deps) (*stored, error) {
	b, err := os.ReadFile(filepath.Join(d.StateDir, githubFile))
	if err != nil {
		return nil, ErrNotConnected
	}
	var s stored
	if json.Unmarshal(b, &s) != nil || s.Token == "" || s.FullName == "" || s.ID == 0 {
		return nil, ErrNotConnected
	}
	return &s, nil
}

// Connect runs the device flow, pins the proofs repo, stores the token owner-only and uploads it
// sealed to the account key (kind 6) so the dashboard can read the repo. The token is never logged
// or returned.
func Connect(ctx context.Context, d Deps) error {
	st, err := state.Read(d.StateDir)
	if err != nil {
		return err
	}
	if st.UserID == "" || st.AccountPub == "" {
		return ErrNotPaired
	}
	token, err := d.Flow.Login(ctx)
	if err != nil {
		return err
	}
	c := gh.NewClient(d.GitHubBase, token)
	r, err := gh.EnsureRepo(ctx, c)
	if err != nil {
		return err
	}
	if prev, err := load(d); err == nil && prev.ID != r.ID {
		return gh.ErrRepoUnsafe // a different repo than the pinned one: refuse silently switching
	}
	raw, err := json.Marshal(stored{Token: token, Repo: r})
	if err != nil {
		return err
	}
	if err := writeOwnerOnly(filepath.Join(d.StateDir, githubFile), raw); err != nil {
		return err
	}
	if err := state.With(d.StateDir, func(s *state.State) error { s.RepoFullName = r.FullName; return nil }); err != nil {
		return err
	}
	return uploadStorageLink(ctx, d, st, token, r)
}

func uploadStorageLink(ctx context.Context, d Deps, st *state.State, token string, r gh.Repo) error {
	akRaw, err := ic.UnB64(st.AccountPub)
	if err != nil {
		return err
	}
	ak, err := ic.ParseKEMPublic(akRaw)
	if err != nil {
		return err
	}
	plain, err := json.Marshal(map[string]any{"token": token, "repo_full_name": r.FullName, "repo_id": r.ID})
	if err != nil {
		return err
	}
	sealed, err := ic.Seal(ic.KindStorageToken, ak, ic.AAD{UserID: st.UserID, Version: "0"}, plain)
	if err != nil {
		return err
	}
	ts := d.now().Unix()
	msg, err := ic.StorageLink{UserID: st.UserID, EngineID: d.Keys.EngineID, TokenSealed: sealed, UnixTS: ts}.Message()
	if err != nil {
		return err
	}
	sig, err := ic.Sign(d.Keys.Sign, msg)
	if err != nil {
		return err
	}
	return d.API.Do(ctx, "PUT", "/v1/storage-link", map[string]any{"enc_token": ic.B64(sealed), "engine_sig": sig, "unix_ts": ts}, nil)
}

type item struct {
	Kind     string            `json:"kind"`
	RecordID string            `json:"record_id"`
	Files    map[string]string `json:"files"`
}

// PushOutbox commits queued items in order (one commit each). Without a GitHub connection it does
// nothing (records keep queuing). It stops at the first failure so order is preserved. Returns the
// number of items pushed.
func PushOutbox(ctx context.Context, d Deps) (int, error) {
	s, err := load(d)
	if err != nil {
		return 0, ErrNotConnected
	}
	unlock, err := state.LockFile(d.StateDir, outboxLock, lockWait)
	if err != nil {
		return 0, err
	}
	defer unlock()
	names, err := queued(d.OutboxDir)
	if err != nil || len(names) == 0 {
		return 0, err
	}
	c := gh.NewClient(d.GitHubBase, s.Token)
	if err := gh.CheckPinned(ctx, c, s.Repo); err != nil {
		return 0, err
	}
	pushed := 0
	var head string
	defer func() { // report what reached GitHub even if a later item failed
		if head != "" {
			_ = reportHead(ctx, d, head)
		}
	}()
	for _, name := range names {
		it, files, err := readItem(filepath.Join(d.OutboxDir, name))
		if err != nil {
			if qerr := quarantine(d.OutboxDir, name); qerr != nil {
				return pushed, qerr
			}
			continue
		}
		message, exists := "ideatrail: record "+it.RecordID, "records/"+it.RecordID+".it1"
		if it.Kind == "update" {
			message, exists = "ideatrail: proof "+it.RecordID, ""
		}
		sha, err := gh.CommitFiles(ctx, c, s.Repo, files, message, exists, d.Sleep)
		if err != nil {
			return pushed, err
		}
		head = sha
		if err := os.Remove(filepath.Join(d.OutboxDir, name)); err != nil {
			return pushed, err
		}
		pushed++
		if it.Kind == "update" {
			_ = d.API.Do(ctx, "POST", "/v1/anchors/"+it.RecordID+"/synced", map[string]string{"target": "repo"}, nil)
		}
	}
	return pushed, nil
}

func reportHead(ctx context.Context, d Deps, sha string) error {
	st, err := state.Read(d.StateDir)
	if err != nil {
		return err
	}
	now := d.now()
	msg, err := ic.RepoHead{UserID: st.UserID, EngineID: d.Keys.EngineID, CommitSHA: sha, UnixTS: now.Unix()}.Message()
	if err != nil {
		return err
	}
	sig, err := ic.Sign(d.Keys.Sign, msg)
	if err != nil {
		return err
	}
	return d.API.Do(ctx, "POST", "/v1/repo-heads", map[string]any{"commit_sha": sha, "signature": sig, "reported_at": ic.FormatTime(now)}, nil)
}

func queued(dir string) ([]string, error) {
	es, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range es {
		if n := e.Name(); strings.HasSuffix(n, ".json") && !strings.HasPrefix(n, ".") {
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return out, nil
}

var recordIDRe = regexp.MustCompile(`^[0-9a-hjkmnp-tv-z]{26}$`)

// allowedPaths are the only repo paths an item for this record may write (spec §12).
func allowedPaths(id string) map[string]bool {
	return map[string]bool{"records/" + id + ".it1": true, "proofs/" + id + "/bundle.json": true, "proofs/" + id + "/original.it1": true}
}

// readItem reads one queue file (no symlinks, size-capped) and checks every field: the record id
// shape, the kind, and that each path is one of this record's own files.
func readItem(path string) (*item, map[string][]byte, error) {
	bad := errors.New("queue item unreadable")
	fi, err := os.Lstat(path)
	if err != nil || !fi.Mode().IsRegular() || fi.Size() > maxItemBytes {
		return nil, nil, bad
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, bad
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, maxItemBytes+1))
	if err != nil || len(raw) > maxItemBytes {
		return nil, nil, bad
	}
	var it item
	if json.Unmarshal(raw, &it) != nil || !recordIDRe.MatchString(it.RecordID) || len(it.Files) == 0 {
		return nil, nil, bad
	}
	switch it.Kind {
	case "":
		it.Kind = "record"
	case "record", "update":
	default:
		return nil, nil, bad
	}
	ok := allowedPaths(it.RecordID)
	files := map[string][]byte{}
	for p, b64 := range it.Files {
		if !ok[p] {
			return nil, nil, errors.New("queue item has an unexpected path")
		}
		b, err := ic.UnB64(b64)
		if err != nil {
			return nil, nil, bad
		}
		files[p] = b
	}
	return &it, files, nil
}

// quarantine moves a queue file that can never be pushed out of the way (to bad/), so one broken
// local file does not stop every later record. Remote refusals still stop the queue.
func quarantine(dir, name string) error {
	bd := filepath.Join(dir, "bad")
	if err := os.MkdirAll(bd, 0o700); err != nil {
		return err
	}
	return os.Rename(filepath.Join(dir, name), filepath.Join(bd, name))
}

func writeOwnerOnly(path string, b []byte) error {
	tmp := path + ".tmp"
	_ = os.Remove(tmp) // a leftover temp file may have looser permissions
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
