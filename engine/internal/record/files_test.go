package record

import (
	"archive/tar"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"ideatrail/engine/internal/commit"
	"ideatrail/engine/internal/pathguard"
)

func guardFor(t *testing.T) (*pathguard.Guard, string) {
	t.Helper()
	base, _ := filepath.EvalSymlinks(t.TempDir())
	folder := filepath.Join(base, "가계부")
	_ = os.MkdirAll(filepath.Join(folder, "docs"), 0o700)
	return &pathguard.Guard{Folders: []pathguard.Folder{{Path: folder, RootID: "01jcm3v8q7s2kx4f9d6b5n0tqx"}}}, folder
}

func write(t *testing.T, p string, b []byte) string {
	t.Helper()
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	if err := os.WriteFile(p, b, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSingleSmallFileKeepsOriginal(t *testing.T) {
	g, folder := guardFor(t)
	p := write(t, filepath.Join(folder, "docs", "plan.md"), []byte("# plan"))
	c, err := Collect(g, []string{p})
	if err != nil {
		t.Fatal(err)
	}
	if c.Manifest || string(c.Original) != "# plan" || c.Commitment != commit.Commit(c.Nonce, []byte("# plan")) {
		t.Fatalf("%+v", c)
	}
}

func TestLargeAndMediaFilesAreFingerprintOnly(t *testing.T) {
	g, folder := guardFor(t)
	big := write(t, filepath.Join(folder, "big.bin"), bytes.Repeat([]byte{7}, 6<<20))
	c, err := Collect(g, []string{big})
	if err != nil {
		t.Fatal(err)
	}
	if c.Original != nil || c.Files[0].Original {
		t.Fatal("6MB file kept an original")
	}
	content, _ := os.ReadFile(big)
	if c.Commitment != commit.Commit(c.Nonce, content) {
		t.Fatal("streamed commitment differs")
	}
	img := write(t, filepath.Join(folder, "shot.PNG"), []byte("png"))
	c2, _ := Collect(g, []string{img})
	if c2.Original != nil {
		t.Fatal("image kept an original")
	}
}

func TestManifestUsesNormalizedPaths(t *testing.T) {
	g, folder := guardFor(t)
	nfd := "가.md" // 가 (NFD)
	a := write(t, filepath.Join(folder, nfd), []byte("a"))
	b := write(t, filepath.Join(folder, "docs", "b.md"), []byte("b"))
	c, err := Collect(g, []string{b, a})
	if err != nil {
		t.Fatal(err)
	}
	want, _ := commit.Manifest([]commit.Entry{{Path: "가.md", Content: []byte("a")}, {Path: "docs/b.md", Content: []byte("b")}})
	if !c.Manifest || c.Commitment != commit.Commit(c.Nonce, want) {
		t.Fatal("manifest commitment mismatch")
	}
	tr := tar.NewReader(bytes.NewReader(c.Original))
	var names []string
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, h.Name)
	}
	if len(names) != 2 || names[0] != "docs/b.md" && names[0] != "가.md" {
		t.Fatalf("tar %v", names)
	}
}

func TestSameContentDifferentNonce(t *testing.T) {
	g, folder := guardFor(t)
	p := write(t, filepath.Join(folder, "a.md"), []byte("same"))
	c1, _ := Collect(g, []string{p})
	c2, _ := Collect(g, []string{p})
	if c1.Commitment == c2.Commitment {
		t.Fatal("commitments must differ (fresh nonce)")
	}
}

func TestLimitsAndGuard(t *testing.T) {
	g, folder := guardFor(t)
	if _, err := Collect(g, nil); !errors.Is(err, ErrNoFiles) {
		t.Fatal(err)
	}
	many := make([]string, MaxFiles+1)
	if _, err := Collect(g, many); !errors.Is(err, ErrTooMany) {
		t.Fatal(err)
	}
	env := write(t, filepath.Join(folder, ".env"), []byte("SECRET=1"))
	if _, err := Collect(g, []string{env}); !errors.Is(err, pathguard.ErrNotAllowed) {
		t.Fatalf("got %v", err)
	}
}
