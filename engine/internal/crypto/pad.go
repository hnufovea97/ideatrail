package crypto

import "errors"

// ErrBadPadding means the plaintext did not carry valid ISO 7816-4 padding.
var ErrBadPadding = errors.New("bad_padding")

var padSteps = []int{256, 512, 1024, 2048, 4096}

const padBlock = 4096

// PaddedLen returns the target length for n plaintext bytes (spec §6).
func PaddedLen(n int) int {
	need := n + 1
	for _, s := range padSteps {
		if need <= s {
			return s
		}
	}
	return (need + padBlock - 1) / padBlock * padBlock
}

// Pad appends 0x80 then zeros up to PaddedLen.
func Pad(p []byte) []byte {
	out := make([]byte, PaddedLen(len(p)))
	copy(out, p)
	out[len(p)] = 0x80
	return out
}

// Unpad strips ISO 7816-4 padding and rejects lengths that are not a spec target.
func Unpad(p []byte) ([]byte, error) {
	for i := len(p) - 1; i >= 0; i-- {
		switch p[i] {
		case 0x00:
			continue
		case 0x80:
			if PaddedLen(i) != len(p) {
				return nil, ErrBadPadding
			}
			return p[:i], nil
		default:
			return nil, ErrBadPadding
		}
	}
	return nil, ErrBadPadding
}
