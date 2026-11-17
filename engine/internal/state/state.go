// Package state keeps the engine's small JSON state file (spec §13) under an exclusive lock
// (spec §2): every change goes through With, which locks state.lock, reads state.json, applies the
// change and atomically replaces the file.
package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const (
	fileName = "state.json"
	lockName = "state.lock"
	// MaxSeq is the server's limit for sequences (D1 INTEGER is signed 64-bit).
	MaxSeq = uint64(1)<<63 - 1
	// MaxSeenMsgIDs bounds the replay list for inbox messages (spec §13).
	MaxSeenMsgIDs = 1000
)

var ErrSeqExhausted = errors.New("sequence exhausted")

// LockTimeout bounds how long a caller waits for state.lock held by another engine process.
var LockTimeout = 30 * time.Second

var ErrLockTimeout = errors.New("state is locked by another engine process")

// Seq is a sequence number stored as a JSON string so values above 2^53 stay exact.
type Seq uint64

func (s Seq) MarshalJSON() ([]byte, error) { return json.Marshal(strconv.FormatUint(uint64(s), 10)) }

func (s *Seq) UnmarshalJSON(b []byte) error {
	var str string
	if err := json.Unmarshal(b, &str); err != nil {
		return err
	}
	v, err := strconv.ParseUint(str, 10, 64)
	if err != nil {
		return err
	}
	*s = Seq(v)
	return nil
}

// Next increments the sequence and returns the new value (sequences start at 1).
func (s *Seq) Next() (uint64, error) {
	if uint64(*s) >= MaxSeq {
		return 0, ErrSeqExhausted
	}
	*s++
	return uint64(*s), nil
}

// Root is per-idea state; titles are never stored here (spec §13: no titles).
type Root struct {
	Stage        string   `json:"stage,omitempty"`
	EmptySlots   []string `json:"empty_slots,omitempty"`
	LastRecordID string   `json:"last_record_id,omitempty"`
	LastRecordAt string   `json:"last_record_at,omitempty"`
}

// Approval is a request this engine made; inbox answers must match one of these (M3b review).
type Approval struct {
	Kind      string   `json:"kind"`
	Folders   []string `json:"folders"` // resolved real paths the engine asked about
	CreatedAt string   `json:"created_at"`
	Done      bool     `json:"done,omitempty"`
	Body      string   `json:"body,omitempty"` // signed request body, kept until the server accepts it
}

// State is the whole state.json document.
type State struct {
	ReqSeq         Seq                 `json:"req_seq"`
	LogSeq         Seq                 `json:"log_seq"`
	ApprSeq        Seq                 `json:"appr_seq"`
	SeenMsgIDs     []string            `json:"seen_msg_ids,omitempty"`
	UserID         string              `json:"user_id,omitempty"`
	AccountPub     string              `json:"account_pubkey,omitempty"` // b64u, pinned at pairing
	RepoFullName   string              `json:"repo_full_name,omitempty"`
	Roots          map[string]Root     `json:"roots,omitempty"`
	Folders        map[string]string   `json:"folders,omitempty"` // resolved absolute folder → root_id (registered only via approved inbox)
	PendingUploads []string            `json:"pending_uploads,omitempty"`
	Blocked        string              `json:"blocked,omitempty"`         // fixed code while the server keeps refusing an upload
	BlockedVersion string              `json:"blocked_version,omitempty"` // engine version that hit the block (a new version retries)
	AnchorsCursor  Seq                 `json:"anchors_cursor"`
	Approvals      map[string]Approval `json:"approvals,omitempty"`
}

// RememberMsgID records a processed inbox msg_id, keeping the newest MaxSeenMsgIDs.
// It reports false when the id was already seen (replay).
func (s *State) RememberMsgID(id string) bool {
	for _, seen := range s.SeenMsgIDs {
		if seen == id {
			return false
		}
	}
	s.SeenMsgIDs = append(s.SeenMsgIDs, id)
	if n := len(s.SeenMsgIDs); n > MaxSeenMsgIDs {
		s.SeenMsgIDs = append([]string(nil), s.SeenMsgIDs[n-MaxSeenMsgIDs:]...)
	}
	return true
}

// With runs fn on the current state under the exclusive lock and saves the result atomically
// if fn returns nil. The lock is held for the whole call, so callers may do I/O inside fn when
// the spec requires it (e.g. holding req_seq until the server answers).
func With(dir string, fn func(*State) error) error {
	unlock, err := lock(filepath.Join(dir, lockName), LockTimeout)
	if err != nil {
		return fmt.Errorf("state lock: %w", err)
	}
	defer unlock()
	s, err := read(filepath.Join(dir, fileName))
	if err != nil {
		return err
	}
	if err := fn(s); err != nil {
		return err
	}
	return write(dir, s)
}

// LockFile takes an exclusive cross-process lock on dir/name (e.g. "request.lock"), waiting up to
// timeout, and returns the release function. Used to keep one engine request in flight (spec §2).
func LockFile(dir, name string, timeout time.Duration) (func(), error) {
	return lock(filepath.Join(dir, name), timeout)
}

// Read returns a snapshot under the lock (no write).
func Read(dir string) (*State, error) {
	var out *State
	err := With(dir, func(s *State) error {
		out = s
		return errNoWrite
	})
	if errors.Is(err, errNoWrite) {
		return out, nil
	}
	return nil, err
}

var errNoWrite = errors.New("no write")

func read(path string) (*State, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return &State{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("state read: %w", err)
	}
	var s State
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, fmt.Errorf("state parse: %w", err)
	}
	return &s, nil
}

func write(dir string, s *State) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, fileName+".tmp")
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY|noFollow, 0o600)
	if err != nil {
		return fmt.Errorf("state write: %w", err)
	}
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmp)
		}
	}()
	if _, err := f.Write(b); err != nil {
		f.Close()
		return fmt.Errorf("state write: %w", err)
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return fmt.Errorf("state sync: %w", err)
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := replace(tmp, filepath.Join(dir, fileName)); err != nil {
		return err
	}
	ok = true
	return syncDir(dir)
}

// SyncDir makes a rename/create in dir durable (no-op where the OS journals it).
func SyncDir(dir string) error { return syncDir(dir) }
