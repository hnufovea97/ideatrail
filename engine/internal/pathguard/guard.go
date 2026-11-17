// Package pathguard decides which files the engine may read: only regular files inside a
// registered folder, never secrets or engine files, opened through os.Root so symlinks and
// "../" cannot escape the folder between the check and the read.
package pathguard

import (
	"bufio"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

// ErrNotAllowed is the only error callers (and the AI) see: no hint whether a file exists.
var ErrNotAllowed = errors.New("file not allowed")

const (
	ignoreFile     = ".ideaignore"
	maxIgnoreBytes = 64 * 1024
	maxIgnoreLines = 500
)

// Folder is a registered idea folder (resolved absolute path).
type Folder struct {
	Path   string
	RootID string
}

// Guard holds registered folders and paths that must never be read (engine folder, local proof
// copies, outbox).
type Guard struct {
	Folders   []Folder
	Deny      []string // directories never readable (engine folder, proof copies, outbox)
	DenyFiles []string // files never readable even through a hard link (engine.key, state.json)
}

// Opened is a file that passed every check, already open.
type Opened struct {
	File   *os.File
	Folder Folder
	Rel    string // slash-separated, relative to the folder
	Info   os.FileInfo
}

// Open checks p and opens it. On any failure it returns ErrNotAllowed.
func (g *Guard) Open(p string) (*Opened, error) {
	o, err := g.open(p)
	if err != nil {
		return nil, ErrNotAllowed
	}
	return o, nil
}

func (g *Guard) open(p string) (*Opened, error) {
	if isUNC(p) {
		return nil, errors.New("unc")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return nil, err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, err
	}
	for _, d := range g.Deny {
		if dr, err := filepath.EvalSymlinks(d); err == nil && within(real, dr) {
			return nil, errors.New("denied")
		}
	}
	f, rel, ok := g.folderOf(real)
	if !ok {
		return nil, errors.New("outside")
	}
	if excluded(rel) {
		return nil, errors.New("excluded")
	}
	root, err := os.OpenRoot(f.Path)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if ignored(root, rel) {
		return nil, errors.New("ignored")
	}
	// os.Root refuses escapes; non-blocking so a FIFO cannot hang the engine before the fstat check.
	file, err := root.OpenFile(filepath.FromSlash(rel), os.O_RDONLY|nonBlock, 0)
	if err != nil {
		return nil, err
	}
	fi, err := file.Stat()
	if err != nil || !fi.Mode().IsRegular() || hardLinked(fi) || g.isDeniedFile(fi) || !g.stillSame(abs, f, fi) {
		file.Close()
		return nil, errors.New("not a plain file")
	}
	return &Opened{File: file, Folder: f, Rel: rel, Info: fi}, nil
}

// stillSame re-resolves the path after opening: if it was swapped for a symlink (even one
// inside the folder, e.g. to .env), the opened file must still be the checked, allowed file.
func (g *Guard) stillSame(abs string, f Folder, opened os.FileInfo) bool {
	real, err := filepath.EvalSymlinks(abs)
	if err != nil || !within(real, f.Path) {
		return false
	}
	rel, err := filepath.Rel(f.Path, real)
	if err != nil || excluded(filepath.ToSlash(rel)) {
		return false
	}
	now, err := os.Stat(real)
	return err == nil && os.SameFile(now, opened)
}

func (g *Guard) isDeniedFile(fi os.FileInfo) bool {
	for _, p := range g.DenyFiles {
		if d, err := os.Stat(p); err == nil && os.SameFile(d, fi) {
			return true
		}
	}
	return false
}

func (g *Guard) folderOf(real string) (Folder, string, bool) {
	for _, f := range g.Folders {
		fr, err := filepath.EvalSymlinks(f.Path) // re-resolve every time
		if err != nil || g.unsafeFolder(fr) {
			continue
		}
		if within(real, fr) {
			rel, err := filepath.Rel(fr, real)
			if err != nil || rel == "." {
				return Folder{}, "", false
			}
			return Folder{Path: fr, RootID: f.RootID}, filepath.ToSlash(rel), true
		}
	}
	return Folder{}, "", false
}

// unsafeFolder re-applies the registration rules on every read: a registered folder swapped
// for a link to the home folder, a secrets folder or an engine ancestor is ignored.
func (g *Guard) unsafeFolder(real string) bool {
	if broadOrSecret(real) {
		return true
	}
	for _, d := range g.Deny {
		if dr, err := filepath.EvalSymlinks(d); err == nil && within(dr, real) {
			return true
		}
	}
	return false
}

// broadOrSecret: filesystem roots, the home folder itself, or any path with an excluded
// component (e.g. ~/.aws, ~/.ssh, ~/.config/gcloud).
func broadOrSecret(real string) bool {
	if filepath.Dir(real) == real {
		return true
	}
	if h, err := os.UserHomeDir(); err == nil {
		if hr, err := filepath.EvalSymlinks(h); err == nil {
			if samePath(real, hr) {
				return true
			}
			if within(real, hr) {
				if rel, err := filepath.Rel(hr, real); err == nil && excluded(filepath.ToSlash(rel)) {
					return true
				}
			}
		}
	}
	return excluded(filepath.ToSlash(real))
}

// ValidateFolder refuses folders that are too broad, hold secrets, or contain the engine's files.
func ValidateFolder(folder, engineDir string) error {
	real, err := filepath.EvalSymlinks(folder)
	if err != nil {
		return ErrNotAllowed
	}
	if fi, err := os.Stat(real); err != nil || !fi.IsDir() {
		return ErrNotAllowed
	}
	if broadOrSecret(real) {
		return ErrNotAllowed
	}
	if er, err := filepath.EvalSymlinks(engineDir); err == nil && within(er, real) {
		return ErrNotAllowed
	}
	return nil
}

func caseInsensitive() bool { return runtime.GOOS == "darwin" || runtime.GOOS == "windows" }

func samePath(a, b string) bool {
	if caseInsensitive() {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// within reports whether p is root or inside it.
func within(p, root string) bool {
	if caseInsensitive() {
		p, root = strings.ToLower(p), strings.ToLower(root)
	}
	rel, err := filepath.Rel(root, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func isUNC(p string) bool {
	return runtime.GOOS == "windows" && (strings.HasPrefix(p, `\\`) || strings.HasPrefix(p, `//`))
}

// ignored applies the folder's .ideaignore (add-only: "!" lines cannot un-exclude anything).
// It fails closed: an unreadable, oversized or malformed .ideaignore blocks the folder's files.
func ignored(root *os.Root, rel string) bool {
	f, err := root.Open(ignoreFile)
	if errors.Is(err, os.ErrNotExist) {
		return false
	}
	if err != nil {
		return true
	}
	defer f.Close()
	if fi, err := f.Stat(); err != nil || fi.Size() > maxIgnoreBytes {
		return true
	}
	sc := bufio.NewScanner(io.LimitReader(f, maxIgnoreBytes))
	lines := 0
	for sc.Scan() {
		if lines++; lines > maxIgnoreLines {
			return true
		}
		pat := strings.TrimSpace(sc.Text())
		if pat == "" || strings.HasPrefix(pat, "#") || strings.HasPrefix(pat, "!") {
			continue
		}
		if _, err := path.Match(strings.Trim(pat, "/"), "x"); err != nil {
			return true // malformed pattern
		}
		if matchIgnore(strings.ToLower(pat), strings.ToLower(rel)) {
			return true
		}
	}
	return sc.Err() != nil
}

func matchIgnore(pat, rel string) bool {
	dirOnly := strings.HasSuffix(pat, "/")
	pat = strings.Trim(pat, "/")
	parts := strings.Split(rel, "/")
	if strings.Contains(pat, "/") {
		for i := range parts {
			if ok, _ := path.Match(pat, strings.Join(parts[:i+1], "/")); ok && (!dirOnly || i < len(parts)-1) {
				return true
			}
		}
		return false
	}
	for i, part := range parts {
		if ok, _ := path.Match(pat, part); ok && (!dirOnly || i < len(parts)-1) {
			return true
		}
	}
	return false
}
