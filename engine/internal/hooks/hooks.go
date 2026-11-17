// Package hooks implements the Claude Code hook commands. Hooks read local files only — never the
// network (spec §2) — and print only fixed sentences.
package hooks

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"

	"ideatrail/engine/internal/state"
)

const (
	GuardMessage  = "ideatrail 엔진 폴더는 열 수 없어요"
	maxInput      = 1 << 20
	maxGuardInput = 64 << 20
	markerTTL     = 7 * 24 * time.Hour
	scanBudget    = 2 * time.Second
	maxScanFiles  = 20000
)

var sessionRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// pathFields are the tool-input keys that name files or run commands; document text fields
// (content, new_string, old_string) are deliberately not scanned.
var pathFields = map[string]bool{"file_path": true, "path": true, "notebook_path": true, "pattern": true, "glob": true, "command": true}

type hookInput struct {
	SessionID      string         `json:"session_id"`
	ToolName       string         `json:"tool_name"`
	ToolInput      map[string]any `json:"tool_input"`
	Cwd            string         `json:"cwd"`
	StopHookActive bool           `json:"stop_hook_active"`
}

func readInput(r io.Reader) (*hookInput, bool) {
	var in hookInput
	if err := json.NewDecoder(io.LimitReader(r, maxInput)).Decode(&in); err != nil {
		return nil, false
	}
	return &in, true
}

// Guard returns exit code 2 when a tool call could reach the engine's own files. Best effort, so it
// errs toward blocking: anything unreadable is blocked, the whole Application Support / AppData
// area is off limits, and so are commands aimed at the home or Library folder itself (which would
// let a later relative path reach the engine folder).
func Guard(r io.Reader, protected []string) int {
	in, ok := readGuardInput(r)
	if !ok {
		return 2
	}
	home, _ := os.UserHomeDir()
	targets := protectedForms(protected, home)
	nhome := strings.TrimRight(normalize(home, home), "/")
	var nprot []string
	for _, p := range protected {
		nprot = append(nprot, normalize(p, home))
	}
	var values []string
	collect(in.ToolInput, &values)
	for _, v := range values {
		n := normalize(v, home)
		if hits(n, targets) || sweepsHome(n, nhome, strings.TrimRight(normalize(in.Cwd, home), "/"), nprot) {
			return 2
		}
		if in.Cwd != "" && !strings.HasPrefix(n, "/") { // relative to the session directory
			if hits(normalize(filepath.Join(in.Cwd, v), home), targets) {
				return 2
			}
		}
	}
	if in.ToolName == "Grep" || in.ToolName == "Glob" {
		base := in.Cwd
		if p, ok := in.ToolInput["path"].(string); ok && p != "" {
			base = p
		}
		nb := strings.TrimRight(normalize(base, home), "/") + "/"
		for _, p := range protected {
			if nb == "/" || strings.HasPrefix(normalize(p, home)+"/", nb) {
				return 2
			}
		}
	}
	return 0
}

// readGuardInput reads the whole hook input; too large or not JSON fails closed.
func readGuardInput(r io.Reader) (*hookInput, bool) {
	b, err := io.ReadAll(io.LimitReader(r, maxGuardInput+1))
	if err != nil || len(b) > maxGuardInput {
		return nil, false
	}
	var in hookInput
	if json.Unmarshal(b, &in) != nil {
		return nil, false
	}
	return &in, true
}

func hits(n string, targets []string) bool {
	for _, t := range targets {
		if strings.Contains(n, t) {
			return true
		}
	}
	return false
}

// sweepsHome reports a word that is exactly the home or ~/Library folder (cd ~, grep -r x ~/Library)
// or a wildcard that could expand into an engine folder (~/Library/App*/idea*).
func sweepsHome(n, nhome, ncwd string, nprot []string) bool {
	if nhome == "" {
		return false
	}
	for _, w := range strings.FieldsFunc(n, func(r rune) bool {
		return r == ' ' || r == ';' || r == '&' || r == '|' || r == '(' || r == ')' || r == '='
	}) {
		w = strings.TrimRight(w, "/")
		if w == nhome || w == nhome+"/library" {
			return true
		}
		if !strings.HasPrefix(w, "/") {
			if ncwd == "" {
				continue
			}
			w = ncwd + "/" + w
		}
		if i := strings.IndexAny(w, "*?[{"); i >= 0 {
			for _, p := range nprot {
				if strings.HasPrefix(p, w[:i]) {
					return true
				}
			}
		}
	}
	return false
}

func collect(v any, out *[]string) {
	switch x := v.(type) {
	case map[string]any:
		for k, val := range x {
			if pathFields[k] {
				if s, ok := val.(string); ok {
					*out = append(*out, s)
				}
			}
			if k == "edits" { // MultiEdit
				collect(val, out)
			}
		}
	case []any:
		for _, e := range x {
			collect(e, out)
		}
	}
}

var envRe = regexp.MustCompile(`(?i)(\$\{home\}|\$home|%userprofile%|\$env:userprofile)`)
var tildeRe = regexp.MustCompile(`(^|[\s=:(])~[^/\s]*`)
var localRe = regexp.MustCompile(`(?i)(%localappdata%|\$env:localappdata|\$\{localappdata\})`)

// normalize lowercases, NFC-folds, strips quotes/escapes, unifies separators and expands home
// spellings so `"~/Library/Application\ Support/IdeaTrail"` matches the real path.
func normalize(s, home string) string {
	s = norm.NFC.String(s)
	s = strings.NewReplacer(`\ `, " ", `"`, "", `'`, "", "`", "").Replace(s)
	s = strings.ReplaceAll(s, `\`, "/")
	if home != "" {
		h := strings.ReplaceAll(home, `\`, "/")
		s = envRe.ReplaceAllString(s, h)
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			s = localRe.ReplaceAllString(s, strings.ReplaceAll(local, `\`, "/"))
		}
		s = tildeRe.ReplaceAllString(s, "${1}"+h)
	}
	s = strings.ToLower(s)
	for strings.Contains(s, "//") {
		s = strings.ReplaceAll(s, "//", "/")
	}
	return s
}

// protectedForms lists strings that identify engine files in any spelling.
func protectedForms(protected []string, home string) []string {
	var out []string
	for _, p := range protected {
		n := normalize(p, home)
		out = append(out, n)
		if home != "" {
			if rel, err := filepath.Rel(home, p); err == nil && !strings.HasPrefix(rel, "..") {
				out = append(out, normalize(rel, ""))
			}
		}
	}
	return append(out, "engine.key", "application support", "appdata", "ideatrail-outbox", "ideatrail-github", norm.NFC.String("ideatrail-증명"))
}

// SessionStart remembers when the session began (for the stop hook) and returns at most one
// fixed line for Claude's context.
func SessionStart(r io.Reader, stateDir string) string {
	in, ok := readInput(r)
	if !ok || !sessionRe.MatchString(in.SessionID) {
		return ""
	}
	dir := filepath.Join(stateDir, "sessions")
	_ = os.MkdirAll(dir, 0o700)
	prune(dir)
	_ = os.WriteFile(filepath.Join(dir, in.SessionID+".start"), []byte(strconv.FormatInt(time.Now().Unix(), 10)), 0o600)
	st, err := state.Read(stateDir)
	switch {
	case err != nil:
		return ""
	case st.UserID == "" || st.AccountPub == "":
		return "ideatrail: 아직 가입 전이에요. 기록을 시작하면 가입 화면이 열려요."
	case st.Blocked != "":
		return "ideatrail: 서버가 기록을 받지 않고 있어요. 엔진을 업데이트해 주세요."
	}
	return ""
}

// Stop asks once per session whether to record unrecorded changes in this project's folder.
// Returns the JSON to print (empty for nothing).
func Stop(r io.Reader, stateDir string) string {
	in, ok := readInput(r)
	if !ok || in.StopHookActive || !sessionRe.MatchString(in.SessionID) {
		return ""
	}
	dir := filepath.Join(stateDir, "sessions")
	startRaw, err := os.ReadFile(filepath.Join(dir, in.SessionID+".start"))
	if err != nil {
		return "" // no baseline: say nothing
	}
	f, err := os.OpenFile(filepath.Join(dir, in.SessionID+".stop"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil { // already asked (or cannot record that we asked): stay silent
		return ""
	}
	_ = f.Close()
	start, err := strconv.ParseInt(strings.TrimSpace(string(startRaw)), 10, 64)
	if err != nil {
		return ""
	}
	st, err := state.Read(stateDir)
	if err != nil {
		return ""
	}
	folder, root := folderFor(st, in.Cwd)
	if folder == "" {
		return ""
	}
	since := time.Unix(start, 0)
	if t, err := time.Parse(time.RFC3339, st.Roots[root].LastRecordAt); err == nil && t.After(since) {
		since = t
	}
	n := changedSince(folder, since)
	if n == 0 {
		return ""
	}
	b, _ := json.Marshal(map[string]string{"decision": "block", "reason": "기록 안 된 변경 " + strconv.Itoa(n) + "건이 있어요. ideatrail에 남길까요?"})
	return string(b)
}

func folderFor(st *state.State, cwd string) (string, string) {
	real, err := filepath.EvalSymlinks(cwd)
	if err != nil {
		return "", ""
	}
	best, root := "", ""
	for f, id := range st.Folders {
		if (real == f || strings.HasPrefix(real, f+string(filepath.Separator))) && len(f) > len(best) {
			best, root = f, id
		}
	}
	return best, root
}

func changedSince(folder string, since time.Time) int {
	deadline := time.Now().Add(scanBudget)
	n, seen := 0, 0
	_ = filepath.WalkDir(folder, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if seen++; seen > maxScanFiles || time.Now().After(deadline) {
			return filepath.SkipAll
		}
		if d.IsDir() && (d.Name() == ".git" || d.Name() == "node_modules" || strings.HasPrefix(d.Name(), ".")) && p != folder {
			return filepath.SkipDir
		}
		if d.Type().IsRegular() {
			if fi, err := d.Info(); err == nil && fi.ModTime().After(since) {
				n++
			}
		}
		return nil
	})
	return n
}

func prune(dir string) {
	es, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range es {
		if fi, err := e.Info(); err == nil && time.Since(fi.ModTime()) > markerTTL {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}
