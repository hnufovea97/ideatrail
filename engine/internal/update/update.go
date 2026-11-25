// Package update is the update gate: the engine runs a new version only after the user approves it
// on the dashboard. It pins the release key at first run, remembers the approved version, and
// lists what changed in plain words (changes.txt is part of the signed binary).
package update

import (
	_ "embed"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"ideatrail/engine/internal/config"
	"ideatrail/engine/internal/state"
)

const (
	maxChanges    = 20
	maxChangeRune = 200
	// MsgDowngrade is the single line shown when the version went backwards.
	MsgDowngrade = "이전 버전으로 바뀌었어요."
)

// ErrBadVersion: a release binary whose version is not a plain major.minor.patch number.
var ErrBadVersion = errors.New("version is not a release number")

var releaseVersion = regexp.MustCompile(`^\d{1,4}\.\d{1,4}\.\d{1,4}$`)

// IsReleaseVersion reports whether v is a plain major.minor.patch number (the line the dashboard
// and the engine agree on).
func IsReleaseVersion(v string) bool { return releaseVersion.MatchString(v) }

// ErrKeyChanged: the embedded release key differs from the one pinned at first install.
var ErrKeyChanged = errors.New("release key differs from the pinned key")

//go:embed changes.txt
var changesFile string

// Status is the gate's answer at start.
type Status struct {
	Pending bool
	Version string // the new version waiting for approval (Pending only)
}

// WaitingLine is what the AI and the user see while a new version waits for approval.
func WaitingLine(version string) string {
	return "새 버전(" + cleanVersion(version) + ") 확인을 기다려요. 대시보드에서 바뀐 점을 보고 승인해 주세요."
}

// RejectedLine is shown after the dashboard rejected the new version.
const RejectedLine = "대시보드에서 새 버전을 거절해서 기록을 멈췄어요. 다시 승인하거나 플러그인을 이전 버전으로 되돌려 주세요."

// BlockLine returns the fixed line for a pending update, or "" when nothing is pending.
func BlockLine(p *state.UpdatePending) string {
	if p == nil {
		return ""
	}
	if p.Rejected {
		return RejectedLine
	}
	return WaitingLine(p.Version)
}

// cleanVersion keeps a version printable: digits, letters, dots, dashes and plus only.
func cleanVersion(v string) string {
	var b strings.Builder
	for _, r := range v {
		if b.Len() >= 32 {
			break
		}
		if r == '.' || r == '-' || r == '+' || (r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r))) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Pin stores the embedded release key at first run and refuses a different one later.
// An empty key (dev build) does nothing.
func Pin(stateDir, embeddedKey string) error {
	if embeddedKey == "" {
		return nil
	}
	return state.With(stateDir, func(s *state.State) error {
		switch {
		case s.ReleaseKey == "":
			s.ReleaseKey = embeddedKey
		case s.ReleaseKey != embeddedKey:
			return ErrKeyChanged
		}
		return nil
	})
}

// Pinned returns the pinned release key ("" when none yet or no state folder).
func Pinned(stateDir string) (string, error) {
	st, err := state.Read(stateDir)
	if err != nil {
		return "", err
	}
	return st.ReleaseKey, nil
}

// Check compares the running version with the approved one. A first run, an unchanged version and
// a user who has not signed up are accepted; a changed version for a signed-up user waits.
func Check(stateDir, version string) (Status, error) {
	var out Status
	if !IsReleaseVersion(version) {
		if config.Dev() {
			return out, nil // a development build never asks for approval
		}
		return out, ErrBadVersion
	}
	err := state.With(stateDir, func(s *state.State) error {
		out = Status{}
		switch {
		case s.ApprovedVersion == "" || s.UserID == "":
			s.ApprovedVersion, s.UpdatePending = version, nil
		case s.ApprovedVersion == version:
			// only the request for this very version is settled; a newer waiting one stays
			if s.UpdatePending != nil && s.UpdatePending.Version == version {
				s.UpdatePending = nil
			}
		default:
			if s.UpdatePending == nil || s.UpdatePending.Version != version {
				s.UpdatePending = &state.UpdatePending{Version: version}
			}
			out = Status{Pending: true, Version: version}
		}
		return nil
	})
	return out, err
}

// Pending returns the waiting update (nil when none) from local state.
func Pending(stateDir string) *state.UpdatePending {
	st, err := state.Read(stateDir)
	if err != nil || st.UpdatePending == nil {
		return nil
	}
	p := *st.UpdatePending
	return &p
}

// Changes lists the one-line changes for versions after from up to and including to.
func Changes(from, to string) []string { return changesFrom(changesFile, from, to) }

func changesFrom(file, from, to string) []string {
	f, okF := parseVersion(from)
	t, okT := parseVersion(to)
	if !okF || !okT {
		return []string{}
	}
	if compare(f, t) > 0 {
		return []string{MsgDowngrade}
	}
	type item struct {
		v    [3]int
		text string
	}
	var items []item
	for _, line := range strings.Split(file, "\n") {
		ver, text, ok := strings.Cut(strings.TrimRight(line, "\r"), "\t")
		if !ok {
			continue
		}
		v, ok := parseVersion(ver)
		text = cleanLine(text)
		if !ok || text == "" || compare(v, f) <= 0 || compare(v, t) > 0 {
			continue
		}
		items = append(items, item{v, text})
	}
	// stable insertion sort by version (file order kept inside one version)
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && compare(items[j].v, items[j-1].v) < 0; j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
	out := []string{}
	for _, it := range items {
		if len(out) == maxChanges {
			break
		}
		out = append(out, it.text)
	}
	return out
}

// cleanLine drops lines with control characters (empty result) and caps the length.
func cleanLine(s string) string {
	s = strings.TrimSpace(s)
	for _, r := range s {
		if unicode.IsControl(r) {
			return ""
		}
	}
	if utf8.RuneCountInString(s) > maxChangeRune {
		s = string([]rune(s)[:maxChangeRune])
	}
	return s
}

func parseVersion(v string) ([3]int, bool) {
	var out [3]int
	v = strings.TrimSpace(v)
	if !IsReleaseVersion(v) {
		return out, false
	}
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

func compare(a, b [3]int) int {
	for i := range a {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}
