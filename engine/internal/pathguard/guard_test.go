package pathguard

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

type fixture struct {
	g       *Guard
	folder  string
	outside string
	engine  string
}

func setup(t *testing.T) fixture {
	t.Helper()
	base, _ := filepath.EvalSymlinks(t.TempDir())
	folder := filepath.Join(base, "idea")
	outside := filepath.Join(base, "outside")
	engine := filepath.Join(base, "engine")
	for _, d := range []string{folder, outside, engine, filepath.Join(folder, "docs")} {
		_ = os.MkdirAll(d, 0o700)
	}
	write := func(p, s string) { _ = os.WriteFile(p, []byte(s), 0o600) }
	write(filepath.Join(folder, "docs", "plan.md"), "plan")
	write(filepath.Join(outside, "secret.txt"), "secret")
	write(filepath.Join(engine, "engine.key"), "key")
	return fixture{g: &Guard{Folders: []Folder{{Path: folder, RootID: "r1"}}, Deny: []string{engine}}, folder: folder, outside: outside, engine: engine}
}

func mustDeny(t *testing.T, g *Guard, p string) {
	t.Helper()
	if o, err := g.Open(p); !errors.Is(err, ErrNotAllowed) {
		if o != nil {
			o.File.Close()
		}
		t.Fatalf("%s: expected ErrNotAllowed, got %v", p, err)
	}
}

func TestOpensPlainFileInsideFolder(t *testing.T) {
	f := setup(t)
	o, err := f.g.Open(filepath.Join(f.folder, "docs", "plan.md"))
	if err != nil {
		t.Fatal(err)
	}
	defer o.File.Close()
	b, _ := io.ReadAll(o.File)
	if string(b) != "plan" || o.Rel != "docs/plan.md" || o.Folder.RootID != "r1" {
		t.Fatalf("%q %q %q", b, o.Rel, o.Folder.RootID)
	}
}

func TestEscapes(t *testing.T) {
	f := setup(t)
	mustDeny(t, f.g, filepath.Join(f.outside, "secret.txt"))
	mustDeny(t, f.g, filepath.Join(f.folder, "..", "outside", "secret.txt"))
	mustDeny(t, f.g, f.folder) // the folder itself is not a file
	mustDeny(t, f.g, filepath.Join(f.folder, "docs"))
	mustDeny(t, f.g, filepath.Join(f.folder, "missing.md"))
}

func TestSymlinkOutIsDenied(t *testing.T) {
	f := setup(t)
	link := filepath.Join(f.folder, "docs", "notes.md")
	if err := os.Symlink(filepath.Join(f.outside, "secret.txt"), link); err != nil {
		t.Skip(err)
	}
	mustDeny(t, f.g, link)
	dirLink := filepath.Join(f.folder, "elsewhere")
	_ = os.Symlink(f.outside, dirLink)
	mustDeny(t, f.g, filepath.Join(dirLink, "secret.txt"))
}

func TestFixedExclusions(t *testing.T) {
	f := setup(t)
	for _, rel := range []string{
		".env", ".env.local", "prod.env", "config/.npmrc", ".SSH/config", ".ssh/id_rsa", "keys/server.PEM",
		"id_ed25519", "aws/credentials", "my-credentials.json", "service-account-prod.json", ".git/config",
		"node_modules/x/index.js", "infra/terraform.tfstate", ".config/gcloud/creds.db", "vault.kdbx", ".docker/config.json",
	} {
		p := filepath.Join(f.folder, filepath.FromSlash(rel))
		_ = os.MkdirAll(filepath.Dir(p), 0o700)
		_ = os.WriteFile(p, []byte("x"), 0o600)
		mustDeny(t, f.g, p)
	}
}

func TestIdeaignoreIsAddOnly(t *testing.T) {
	f := setup(t)
	_ = os.WriteFile(filepath.Join(f.folder, ".ideaignore"), []byte("# notes\ndrafts/\n*.tmp\n!.env\n"), 0o600)
	_ = os.MkdirAll(filepath.Join(f.folder, "drafts"), 0o700)
	for _, rel := range []string{"drafts/a.md", "x.tmp", ".env"} {
		p := filepath.Join(f.folder, filepath.FromSlash(rel))
		_ = os.WriteFile(p, []byte("x"), 0o600)
		mustDeny(t, f.g, p)
	}
	if o, err := f.g.Open(filepath.Join(f.folder, "docs", "plan.md")); err != nil {
		t.Fatal(err)
	} else {
		o.File.Close()
	}
}

func TestEngineFolderAndHardLinksDenied(t *testing.T) {
	f := setup(t)
	f.g.Folders = append(f.g.Folders, Folder{Path: filepath.Dir(f.engine), RootID: "broad"})
	mustDeny(t, f.g, filepath.Join(f.engine, "engine.key"))
	alias := filepath.Join(f.folder, "docs", "innocent.md")
	if err := os.Link(filepath.Join(f.engine, "engine.key"), alias); err != nil {
		t.Skip(err)
	}
	mustDeny(t, f.g, alias)
}

func TestValidateFolder(t *testing.T) {
	f := setup(t)
	if err := ValidateFolder(f.folder, f.engine); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"/", filepath.Dir(f.engine), filepath.Join(f.folder, "nope")} {
		if err := ValidateFolder(bad, f.engine); !errors.Is(err, ErrNotAllowed) {
			t.Errorf("%s accepted", bad)
		}
	}
	fakeHome, _ := filepath.EvalSymlinks(t.TempDir())
	t.Setenv("HOME", fakeHome)
	if err := ValidateFolder(fakeHome, f.engine); !errors.Is(err, ErrNotAllowed) {
		t.Error("home accepted")
	}
}

func TestMatchIgnore(t *testing.T) {
	cases := []struct {
		pat, rel string
		want     bool
	}{
		{"drafts/", "drafts/a.md", true},
		{"drafts/", "drafts", false}, // dir-only pattern does not match a file named drafts
		{"*.tmp", "a/b/c.tmp", true},
		{"a/b", "a/b/c.md", true},
		{"a/b", "x/a/b", false},
	}
	for _, c := range cases {
		if got := matchIgnore(c.pat, c.rel); got != c.want {
			t.Errorf("%s vs %s: got %v", c.pat, c.rel, got)
		}
	}
}

func TestSecretFoldersCannotBeRegistered(t *testing.T) {
	f := setup(t)
	h, _ := filepath.EvalSymlinks(t.TempDir()) // fake home: never touch the real one
	t.Setenv("HOME", h)
	for _, p := range []string{filepath.Join(h, ".aws"), filepath.Join(h, ".ssh"), filepath.Join(f.folder, ".git")} {
		_ = os.MkdirAll(p, 0o700)
		if err := ValidateFolder(p, f.engine); !errors.Is(err, ErrNotAllowed) {
			t.Errorf("%s accepted", p)
		}
	}
}

func TestSwappedFolderIsIgnored(t *testing.T) {
	f := setup(t)
	// registered folder replaced by a link to the engine folder's parent
	_ = os.RemoveAll(f.folder)
	if err := os.Symlink(filepath.Dir(f.engine), f.folder); err != nil {
		t.Skip(err)
	}
	mustDeny(t, f.g, filepath.Join(f.folder, "engine", "engine.key"))
	mustDeny(t, f.g, filepath.Join(f.folder, "outside", "secret.txt"))
}

func TestDenyFilesCatchHardLinkAliases(t *testing.T) {
	f := setup(t)
	f.g.DenyFiles = []string{filepath.Join(f.engine, "engine.key")}
	if fi, _ := os.Stat(filepath.Join(f.engine, "engine.key")); !f.g.isDeniedFile(fi) {
		t.Fatal("deny file not matched")
	}
}

func TestMalformedIdeaignoreFailsClosed(t *testing.T) {
	f := setup(t)
	_ = os.WriteFile(filepath.Join(f.folder, ".ideaignore"), []byte("[unclosed\n"), 0o600)
	mustDeny(t, f.g, filepath.Join(f.folder, "docs", "plan.md"))
}

func TestFIFODoesNotHang(t *testing.T) {
	f := setup(t)
	p := filepath.Join(f.folder, "pipe.md")
	if err := mkfifo(p); err != nil {
		t.Skip(err)
	}
	mustDeny(t, f.g, p)
}
