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
	Folders []Folder
	Deny    []string
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
	file, err := root.Open(filepath.FromSlash(rel)) // os.Root refuses escapes, even if rel changed under us
	if err != nil {
		return nil, err
	}
	fi, err := file.Stat()
	if err != nil || !fi.Mode().IsRegular() || hardLinked(fi) {
		file.Close()
		return nil, errors.New("not a plain file")
	}
	return &Opened{File: file, Folder: f, Rel: rel, Info: fi}, nil
}

func (g *Guard) folderOf(real string) (Folder, string, bool) {
	for _, f := range g.Folders {
		fr, err := filepath.EvalSymlinks(f.Path) // re-resolve every time
		if err != nil {
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

// ValidateFolder refuses folders that are too broad or contain the engine's own files.
func ValidateFolder(folder, engineDir string) error {
	real, err := filepath.EvalSymlinks(folder)
	if err != nil {
		return ErrNotAllowed
	}
	if fi, err := os.Stat(real); err != nil || !fi.IsDir() {
		return ErrNotAllowed
	}
	if filepath.Dir(real) == real { // filesystem root / drive root
		return ErrNotAllowed
	}
	if h, err := os.UserHomeDir(); err == nil {
		if hr, err := filepath.EvalSymlinks(h); err == nil && samePath(real, hr) {
			return ErrNotAllowed
		}
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
func ignored(root *os.Root, rel string) bool {
	f, err := root.Open(ignoreFile)
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(io.LimitReader(f, maxIgnoreBytes))
	lines := 0
	for sc.Scan() && lines < maxIgnoreLines {
		lines++
		pat := strings.TrimSpace(sc.Text())
		if pat == "" || strings.HasPrefix(pat, "#") || strings.HasPrefix(pat, "!") {
			continue
		}
		if matchIgnore(strings.ToLower(pat), strings.ToLower(rel)) {
			return true
		}
	}
	return false
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
