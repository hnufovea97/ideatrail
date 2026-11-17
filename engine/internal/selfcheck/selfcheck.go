// Package selfcheck verifies the engine's own executable against its release signature
// (<file>.sig, Ed25519) before doing anything (§3.1.10 H).
//
// Limits (stated on purpose): whoever can replace the installed file can also replace this check
// and the embedded key. This catches corruption and swapped artifacts in distribution; protecting
// the install location is the OS's job.
package selfcheck

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

var ErrBadSignature = errors.New("engine file does not match its release signature")

// Message is what the release key signs: label, target, version and the file hash — so a valid
// signature for one platform or version cannot be moved to another artifact. Sign the bytes
// AFTER lipo and codesign. The Mac universal binary is signed as darwin/universal.
func Message(goos, goarch, version string, fileSHA256 [32]byte) []byte {
	return []byte("ideatrail-release-v1\n" + goos + "/" + goarch + "\n" + version + "\n" + string(fileSHA256[:]))
}

// Verify checks exe (symlinks resolved) against exe+".sig". An empty key means a dev build.
func Verify(releasePub, exe, goos, goarch, version string) error {
	if releasePub == "" {
		return nil
	}
	pub, err := base64.RawURLEncoding.DecodeString(releasePub)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return ErrBadSignature
	}
	real, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return ErrBadSignature
	}
	sum, err := fileSHA256(real)
	if err != nil {
		return ErrBadSignature
	}
	sigText, err := os.ReadFile(real + ".sig")
	if err != nil {
		return ErrBadSignature
	}
	sig, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(sigText)))
	if err != nil || len(sig) != ed25519.SignatureSize || !ed25519.Verify(pub, Message(goos, goarch, version, sum), sig) {
		return ErrBadSignature
	}
	return nil
}

func fileSHA256(path string) ([32]byte, error) {
	var out [32]byte
	f, err := os.Open(path)
	if err != nil {
		return out, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return out, err
	}
	copy(out[:], h.Sum(nil))
	return out, nil
}

// Sign produces the .sig content (release tooling).
func Sign(priv ed25519.PrivateKey, goos, goarch, version string, fileSHA256 [32]byte) string {
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, Message(goos, goarch, version, fileSHA256)))
}
