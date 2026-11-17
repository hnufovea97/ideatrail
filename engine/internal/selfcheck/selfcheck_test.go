package selfcheck

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestVerify(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	key := base64.RawURLEncoding.EncodeToString(pub)
	exe := filepath.Join(t.TempDir(), "ideatrail")
	data := []byte("engine-binary")
	_ = os.WriteFile(exe, data, 0o700)
	_ = os.WriteFile(exe+".sig", []byte(Sign(priv, data)+"\n"), 0o600)
	if err := Verify(key, exe); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(exe, []byte("engine-binarY"), 0o700)
	if err := Verify(key, exe); !errors.Is(err, ErrBadSignature) {
		t.Fatal("tampered file accepted")
	}
	_ = os.Remove(exe + ".sig")
	if err := Verify(key, exe); !errors.Is(err, ErrBadSignature) {
		t.Fatal("missing signature accepted")
	}
	if err := Verify("", exe); err != nil {
		t.Fatal("dev build must skip")
	}
}
