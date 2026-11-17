// Package selfcheck verifies the engine's own executable against its release signature
// (bin/<file>.sig, Ed25519 over the file bytes) before doing anything (§3.1.10 H).
package selfcheck

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"os"
	"strings"
)

var ErrBadSignature = errors.New("engine file does not match its release signature")

// Verify checks exe against exe+".sig" with the embedded release key. An empty key means a dev
// build: nothing to check.
func Verify(releasePub, exe string) error {
	if releasePub == "" {
		return nil
	}
	pub, err := base64.RawURLEncoding.DecodeString(releasePub)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return ErrBadSignature
	}
	data, err := os.ReadFile(exe)
	if err != nil {
		return ErrBadSignature
	}
	sigText, err := os.ReadFile(exe + ".sig")
	if err != nil {
		return ErrBadSignature
	}
	sig, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(sigText)))
	if err != nil || len(sig) != ed25519.SignatureSize || !ed25519.Verify(pub, data, sig) {
		return ErrBadSignature
	}
	return nil
}

// Sign produces the .sig content for a file (release tooling).
func Sign(priv ed25519.PrivateKey, data []byte) string {
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, data))
}
