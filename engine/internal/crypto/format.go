// Package crypto implements the Ideatrail crypto spec v1 byte formats for the engine:
// HPKE sealing, Ed25519 signed messages, padding and identifiers.
package crypto

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
)

// CryptoVersion is the trailing AAD field and crypto_version (spec §1).
const CryptoVersion = "1"

// Magic prefixes every sealed or relocked blob (spec §1).
var Magic = []byte("IT1")

const (
	sepAAD  = "\x1f"
	sepSign = "\n"
)

// ErrBadField means a field contained a separator byte (0x1F or 0x0A).
var ErrBadField = errors.New("bad_field")

func joinFields(sep string, fields []string) (string, error) {
	for _, f := range fields {
		if strings.ContainsAny(f, "\x1f\n") {
			return "", ErrBadField
		}
	}
	return strings.Join(fields, sep), nil
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// B64 encodes base64url without padding (spec §1).
func B64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// UnB64 decodes base64url without padding.
func UnB64(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }

func hexSHA(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
