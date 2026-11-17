// Package repo connects the engine to the user's GitHub and pushes the queued commits
// (spec §9-7, §12). Only the MCP process runs this; hooks never do.
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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
	for _, name := range names {
		it, files, err := readItem(filepath.Join(d.OutboxDir, name))
		if err != nil {
			return pushed, err
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
	if head != "" {
		_ = reportHead(ctx, d, head)
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

func readItem(path string) (*item, map[string][]byte, error) {
	fi, err := os.Stat(path)
	if err != nil || fi.Size() > maxItemBytes {
		return nil, nil, errors.New("queue item unreadable")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	var it item
	if json.Unmarshal(raw, &it) != nil || it.RecordID == "" || len(it.Files) == 0 {
		return nil, nil, errors.New("queue item unreadable")
	}
	files := map[string][]byte{}
	for p, b64 := range it.Files {
		if !strings.HasPrefix(p, "records/") && !strings.HasPrefix(p, "proofs/") || strings.Contains(p, "..") {
			return nil, nil, errors.New("queue item has an unexpected path")
		}
		b, err := ic.UnB64(b64)
		if err != nil {
			return nil, nil, err
		}
		files[p] = b
	}
	if it.Kind == "" {
		it.Kind = "record"
	}
	return &it, files, nil
}

func writeOwnerOnly(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
