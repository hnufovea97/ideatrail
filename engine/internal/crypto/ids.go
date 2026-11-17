package crypto

import (
	"io"
	"strings"
	"time"
)

const crockford = "0123456789abcdefghjkmnpqrstvwxyz"

const idBytes = 16

// EncodeBase32 writes big-endian bits as lowercase Crockford base32, zero-padding the last group.
func EncodeBase32(b []byte) string {
	var sb strings.Builder
	var acc uint32
	bits := 0
	for _, x := range b {
		acc = acc<<8 | uint32(x)
		bits += 8
		for bits >= 5 {
			bits -= 5
			sb.WriteByte(crockford[(acc>>bits)&31])
		}
		acc &= 1<<bits - 1
	}
	if bits > 0 {
		sb.WriteByte(crockford[(acc<<(5-bits))&31])
	}
	return sb.String()
}

// NewID returns 16 random bytes as 26 Crockford base32 chars (spec §2).
func NewID(r io.Reader) (string, error) {
	b := make([]byte, idBytes)
	if _, err := io.ReadFull(r, b); err != nil {
		return "", err
	}
	return EncodeBase32(b), nil
}

// FormatTime renders RFC 3339 UTC with second precision and a trailing Z (spec §2).
func FormatTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05Z")
}
