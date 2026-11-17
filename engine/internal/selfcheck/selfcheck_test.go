package selfcheck

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestVerify(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	key := base64.RawURLEncoding.EncodeToString(pub)
	exe := filepath.Join(t.TempDir(), "ideatrail-darwin")
	data := []byte("engine-binary")
	_ = os.WriteFile(exe, data, 0o700)
	_ = os.WriteFile(exe+".sig", []byte(Sign(priv, "darwin", "universal", "0.1.0", sha256.Sum256(data))+"\n"), 0o600)
	if err := Verify(key, exe, "darwin", "universal", "0.1.0"); err != nil {
		t.Fatal(err)
	}
	if err := Verify(key, exe, "windows", "amd64", "0.1.0"); !errors.Is(err, ErrBadSignature) {
		t.Fatal("signature moved to another platform")
	}
	if err := Verify(key, exe, "darwin", "universal", "0.1.1"); !errors.Is(err, ErrBadSignature) {
		t.Fatal("signature moved to another version")
	}
	link := exe + "-link"
	_ = os.Symlink(exe, link)
	if err := Verify(key, link, "darwin", "universal", "0.1.0"); err != nil {
		t.Fatalf("symlinked executable: %v", err)
	}
	_ = os.WriteFile(exe, []byte("engine-binarY"), 0o700)
	if err := Verify(key, exe, "darwin", "universal", "0.1.0"); !errors.Is(err, ErrBadSignature) {
		t.Fatal("tampered file accepted")
	}
	if err := Verify("", exe, "darwin", "universal", "0.1.0"); err != nil {
		t.Fatal("dev build must skip")
	}
}
