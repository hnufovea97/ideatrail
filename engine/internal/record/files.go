// Package record turns files into a sealed, signed, anchored record (spec §4, §7, §8, §12).
package record

import (
	"archive/tar"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"io"
	"path"
	"sort"
	"strings"
	"time"

	"ideatrail/engine/internal/commit"
	"ideatrail/engine/internal/pathguard"
)

const (
	MaxFiles         = 50
	MaxRecordBytes   = 100 << 20 // all files of one record
	MaxOriginalFile  = 5 << 20   // per file, to keep an encrypted original
	MaxOriginalTotal = 25 << 20  // all originals of one record
	nonceLen         = 32
)

var mediaExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".heic": true,
	".mp4": true, ".mov": true, ".avi": true, ".mkv": true}

var (
	ErrNoFiles      = errors.New("no files")
	ErrTooMany      = errors.New("too many files")
	ErrTooLarge     = errors.New("files too large")
	ErrMixedFolders = errors.New("files belong to different ideas")
	ErrChanged      = errors.New("a file changed while it was being read")
)

// File is one fingerprinted file.
type File struct {
	Path     string // normalized, slash-separated, relative to the idea folder
	Size     int64
	Original bool
	sum      [32]byte
	content  []byte // only when the original is kept
}

// Collected is what a record needs from the files.
type Collected struct {
	RootID     string
	Folder     string
	Files      []File
	Nonce      []byte
	Commitment [32]byte
	Manifest   bool
	Original   []byte // nil when any file is too big or media (fingerprint only)
}

// Collect opens every path through the guard, fingerprints them and prepares the original.
func Collect(g *pathguard.Guard, paths []string) (*Collected, error) {
	if len(paths) == 0 {
		return nil, ErrNoFiles
	}
	if len(paths) > MaxFiles {
		return nil, ErrTooMany
	}
	nonce := make([]byte, nonceLen)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	c := &Collected{Nonce: nonce}
	var total int64
	for _, p := range paths {
		o, err := g.Open(p)
		if err != nil {
			return nil, err
		}
		if total+o.Info.Size() > MaxRecordBytes { // checked before reading anything
			o.File.Close()
			return nil, ErrTooLarge
		}
		f, err := readOne(o, nonce, len(paths) == 1, c)
		o.File.Close()
		if err != nil {
			return nil, err
		}
		if c.RootID == "" {
			c.RootID, c.Folder = o.Folder.RootID, o.Folder.Path
		} else if c.RootID != o.Folder.RootID {
			return nil, ErrMixedFolders
		}
		if total += f.Size; total > MaxRecordBytes {
			return nil, ErrTooLarge
		}
		c.Files = append(c.Files, f)
	}
	sort.Slice(c.Files, func(i, j int) bool { return c.Files[i].Path < c.Files[j].Path })
	keepOriginal := true
	var origTotal int64
	for _, f := range c.Files {
		origTotal += f.Size
		if !f.Original {
			keepOriginal = false
		}
	}
	if origTotal > MaxOriginalTotal {
		keepOriginal = false
	}
	if len(c.Files) > 1 {
		c.Manifest = true
		entries := make([]commit.HashedEntry, len(c.Files))
		for i, f := range c.Files {
			entries[i] = commit.HashedEntry{Path: f.Path, Sum: f.sum}
		}
		m, err := commit.ManifestHashed(entries)
		if err != nil {
			return nil, err
		}
		c.Commitment = commit.Commit(nonce, m)
	}
	if !keepOriginal {
		for i := range c.Files {
			c.Files[i].Original, c.Files[i].content = false, nil
		}
		return c, nil
	}
	if len(c.Files) == 1 {
		c.Original = c.Files[0].content
	} else {
		t, err := tarOf(c.Files)
		if err != nil {
			return nil, err
		}
		c.Original = t
	}
	return c, nil
}

// readOne fingerprints one file. Small non-media files are read once (same bytes for hash and
// original); others are streamed. The size and mtime must not change during the read.
func readOne(o *pathguard.Opened, nonce []byte, single bool, c *Collected) (File, error) {
	rel, err := commit.NormalizePath(o.Rel)
	if err != nil {
		return File{}, err
	}
	size := o.Info.Size()
	f := File{Path: rel, Size: size}
	original := size <= MaxOriginalFile && !mediaExt[strings.ToLower(path.Ext(rel))]
	if original {
		b, err := io.ReadAll(io.LimitReader(o.File, size+1))
		if err != nil {
			return f, err
		}
		if int64(len(b)) != size {
			return f, ErrChanged
		}
		f.Original, f.content, f.sum = true, b, sha256.Sum256(b)
		if single {
			c.Commitment = commit.Commit(nonce, b)
		}
	} else if single {
		cm, err := commit.CommitStream(nonce, size, o.File)
		if err != nil {
			return f, ErrChanged
		}
		c.Commitment = cm
	} else {
		h := sha256.New()
		n, err := io.Copy(h, io.LimitReader(o.File, size+1))
		if err != nil || n != size {
			return f, ErrChanged
		}
		copy(f.sum[:], h.Sum(nil))
	}
	if after, err := o.File.Stat(); err != nil || after.Size() != size || !after.ModTime().Equal(o.Info.ModTime()) {
		return f, ErrChanged
	}
	return f, nil
}

// tarOf packs originals deterministically: sorted paths, zero times, mode 0644 (spec §15).
func tarOf(files []File) ([]byte, error) {
	var buf bytes.Buffer
	w := tar.NewWriter(&buf)
	for _, f := range files {
		hdr := &tar.Header{Name: f.Path, Mode: 0o644, Size: int64(len(f.content)), ModTime: time.Unix(0, 0), Format: tar.FormatPAX, Typeflag: tar.TypeReg}
		if err := w.WriteHeader(hdr); err != nil {
			return nil, err
		}
		if _, err := w.Write(f.content); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// FileList is the meta view of the files (no content).
func (c *Collected) FileList() []map[string]any {
	out := make([]map[string]any, 0, len(c.Files))
	for _, f := range c.Files {
		out = append(out, map[string]any{"path": f.Path, "size": f.Size, "original": f.Original})
	}
	return out
}
