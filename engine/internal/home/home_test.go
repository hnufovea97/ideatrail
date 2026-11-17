package home

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureOwnerOnly(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "engine")
	if err := Ensure(dir); err != nil {
		t.Fatal(err)
	}
	fi, _ := os.Stat(dir)
	if fi.Mode().Perm() != 0o700 {
		t.Fatalf("perm %v", fi.Mode())
	}
}

func TestRefusesSyncthingFolder(t *testing.T) {
	root := t.TempDir()
	_ = os.Mkdir(filepath.Join(root, ".stfolder"), 0o700)
	if err := Ensure(filepath.Join(root, "a", "ideatrail")); !errors.Is(err, ErrSyncedFolder) {
		t.Fatalf("got %v", err)
	}
}

func TestRefusesCloudLocations(t *testing.T) {
	fake := t.TempDir()
	t.Setenv("HOME", fake)
	for _, p := range []string{
		filepath.Join(fake, "Library", "Mobile Documents", "com~apple~CloudDocs", "x"),
		filepath.Join(fake, "Library", "CloudStorage", "OneDrive-Personal", "x"),
		filepath.Join(fake, "Dropbox", "x"),
		filepath.Join(fake, "LIBRARY", "cloudstorage", "GoogleDrive", "x"), // case-insensitive on darwin
	} {
		if ok, _ := Synced(p); !ok {
			t.Errorf("%s not detected", p)
		}
	}
	if ok, why := Synced(filepath.Join(fake, "Library", "Application Support", "ideatrail")); ok {
		t.Fatalf("false positive: %s", why)
	}
}

func TestRefusesOneDriveEnv(t *testing.T) {
	od := t.TempDir()
	t.Setenv("OneDrive", od)
	if ok, _ := Synced(filepath.Join(od, "Documents", "x")); !ok {
		t.Fatal("OneDrive env path not detected")
	}
}

func TestSymlinkIntoSyncedFolderIsDetected(t *testing.T) {
	root := t.TempDir()
	synced := filepath.Join(root, "synced")
	_ = os.MkdirAll(filepath.Join(synced, ".stfolder"), 0o700)
	link := filepath.Join(root, "innocent")
	if err := os.Symlink(synced, link); err != nil {
		t.Skip(err)
	}
	if ok, _ := Synced(filepath.Join(link, "ideatrail")); !ok {
		t.Fatal("symlink into synced folder not detected")
	}
}

func TestDirOverride(t *testing.T) {
	t.Setenv(EnvHome, "/tmp/x-ideatrail")
	if d, _ := Dir(); d != "/tmp/x-ideatrail" {
		t.Fatalf("got %s", d)
	}
}
