package commit

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

var tag = []byte("ideatrail/sha256-nonce-v1\x00")

// Commit은 설계문서 §3.1.10 A의 sha256-nonce-v1 지문을 계산한다.
func Commit(nonce, content []byte) [32]byte {
	h := sha256.New()
	h.Write(tag)
	var b4 [4]byte
	binary.BigEndian.PutUint32(b4[:], uint32(len(nonce)))
	h.Write(b4[:])
	h.Write(nonce)
	var b8 [8]byte
	binary.BigEndian.PutUint64(b8[:], uint64(len(content)))
	h.Write(b8[:])
	h.Write(content)
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// ErrSizeMismatch means the stream did not contain exactly the declared number of bytes
// (e.g. the file changed while it was being read).
var ErrSizeMismatch = errors.New("content size changed while reading")

// CommitStream is Commit for content read from r, which must yield exactly size bytes.
func CommitStream(nonce []byte, size int64, r io.Reader) ([32]byte, error) {
	h := sha256.New()
	h.Write(tag)
	var b4 [4]byte
	binary.BigEndian.PutUint32(b4[:], uint32(len(nonce)))
	h.Write(b4[:])
	h.Write(nonce)
	var b8 [8]byte
	binary.BigEndian.PutUint64(b8[:], uint64(size))
	h.Write(b8[:])
	n, err := io.Copy(h, io.LimitReader(r, size+1))
	var out [32]byte
	if err != nil {
		return out, err
	}
	if n != size {
		return out, ErrSizeMismatch
	}
	copy(out[:], h.Sum(nil))
	return out, nil
}

var manifestTag = []byte("ideatrail/manifest-v1\x00")

// HashedEntry is a manifest entry whose file SHA-256 was computed by streaming.
type HashedEntry struct {
	Path string
	Sum  [32]byte
}

var (
	ErrInvalidPath   = errors.New("invalid_path")
	ErrDuplicatePath = errors.New("duplicate_path")
)

// Entry는 여러 파일 버전의 파일 하나. Path는 기록 루트 기준 상대 경로.
type Entry struct {
	Path    string
	Content []byte
}

// NormalizePath는 암호-통신-규격 §7 경로 규칙을 적용한다:
// 잘못된 UTF-8은 오류, NFC, `\`→`/`, 빈 조각(앞뒤 `/`)·`.`·`..` 조각이면 오류, 대소문자는 그대로.
func NormalizePath(p string) (string, error) {
	if !utf8.ValidString(p) {
		return "", fmt.Errorf("%w: 잘못된 UTF-8 %q", ErrInvalidPath, p)
	}
	q := strings.ReplaceAll(norm.NFC.String(p), "\\", "/")
	for _, s := range strings.Split(q, "/") {
		if s == "" || s == "." || s == ".." {
			return "", fmt.Errorf("%w: %q", ErrInvalidPath, p)
		}
	}
	return q, nil
}

// Manifest는 경로를 정규화하고 UTF-8 바이트순으로 정렬해 (경로, 파일 지문) 목록을 만든다.
// 정규화 뒤 같은 경로가 둘이면 ErrDuplicatePath. 파일 내용 바이트는 바꾸지 않는다.
func Manifest(entries []Entry) ([]byte, error) {
	hs := make([]HashedEntry, 0, len(entries))
	for _, e := range entries {
		hs = append(hs, HashedEntry{Path: e.Path, Sum: sha256.Sum256(e.Content)})
	}
	return ManifestHashed(hs)
}

// ManifestHashed builds the manifest from precomputed file hashes (same rules as Manifest).
func ManifestHashed(entries []HashedEntry) ([]byte, error) {
	es := make([]HashedEntry, 0, len(entries))
	for _, e := range entries {
		p, err := NormalizePath(e.Path)
		if err != nil {
			return nil, err
		}
		es = append(es, HashedEntry{Path: p, Sum: e.Sum})
	}
	sort.Slice(es, func(i, j int) bool { return es[i].Path < es[j].Path })
	for i := 1; i < len(es); i++ {
		if es[i].Path == es[i-1].Path {
			return nil, fmt.Errorf("%w: %q", ErrDuplicatePath, es[i].Path)
		}
	}
	out := append([]byte(nil), manifestTag...)
	var b4 [4]byte
	binary.BigEndian.PutUint32(b4[:], uint32(len(es)))
	out = append(out, b4[:]...)
	for _, e := range es {
		p := []byte(e.Path)
		binary.BigEndian.PutUint32(b4[:], uint32(len(p)))
		out = append(out, b4[:]...)
		out = append(out, p...)
		out = append(out, e.Sum[:]...)
	}
	return out, nil
}
