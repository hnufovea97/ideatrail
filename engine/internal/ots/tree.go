// Package ots is the engine's minimal OpenTimestamps support: submitting digests to calendars
// and checking receipts. It mirrors the server parser (api/src/ots/tree.ts) and its limits.
package ots

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"unicode/utf8"
)

const (
	MaxReceiptBytes = 8 * 1024
	maxDepth        = 256
	maxNodes        = 256
	maxArg          = 4096
	maxMsg          = 1024
	maxHashedBytes  = 32 * 1024
	maxAttestations = 8
	maxURI          = 1000
)

var (
	tagPending = []byte{0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e}
	tagBitcoin = []byte{0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01}
)

var ErrBad = errors.New("ots: receipt rejected")

// Attestation is pending (URI) or bitcoin (height).
type Attestation struct {
	Pending string
	Bitcoin uint64
}

// Node is one message in the timestamp tree.
type Node struct {
	Msg          []byte
	Attestations []Attestation
	Next         []*Node
}

type reader struct {
	b      []byte
	i      int
	nodes  int
	hashed int
}

func (r *reader) byte1() (byte, error) {
	if r.i >= len(r.b) {
		return 0, ErrBad
	}
	r.i++
	return r.b[r.i-1], nil
}

func (r *reader) bytes(n int) ([]byte, error) {
	if n < 0 || r.i+n > len(r.b) {
		return nil, ErrBad
	}
	r.i += n
	return r.b[r.i-n : r.i], nil
}

func (r *reader) varuint() (uint64, error) {
	var v uint64
	for shift := uint(0); shift < 49; shift += 7 {
		x, err := r.byte1()
		if err != nil {
			return 0, err
		}
		v |= uint64(x&0x7f) << shift
		if x&0x80 == 0 {
			return v, nil
		}
	}
	return 0, ErrBad
}

func (r *reader) varbytes(max int) ([]byte, error) {
	n, err := r.varuint()
	if err != nil || n > uint64(max) {
		return nil, ErrBad
	}
	return r.bytes(int(n))
}

func (r *reader) attestation() (Attestation, error) {
	tag, err := r.bytes(8)
	if err != nil {
		return Attestation{}, err
	}
	raw, err := r.varbytes(maxURI + 8)
	if err != nil {
		return Attestation{}, err
	}
	p := &reader{b: raw}
	var a Attestation
	switch {
	case bytes.Equal(tag, tagPending):
		uri, err := p.varbytes(maxURI)
		if err != nil || !utf8.Valid(uri) {
			return a, ErrBad
		}
		a.Pending = string(uri)
	case bytes.Equal(tag, tagBitcoin):
		h, err := p.varuint()
		if err != nil {
			return a, err
		}
		a.Bitcoin = h
	default:
		return a, ErrBad
	}
	if p.i != len(raw) {
		return a, ErrBad
	}
	return a, nil
}

func (r *reader) node(msg []byte, depth int) (*Node, error) {
	r.nodes++
	if depth > maxDepth || r.nodes > maxNodes || len(msg) > maxMsg {
		return nil, ErrBad
	}
	n := &Node{Msg: msg}
	one := func(tag byte) error {
		if tag == 0x00 {
			if len(n.Attestations) >= maxAttestations {
				return ErrBad
			}
			a, err := r.attestation()
			if err != nil {
				return err
			}
			n.Attestations = append(n.Attestations, a)
			return nil
		}
		var next []byte
		switch tag {
		case 0x08:
			if r.hashed += len(msg); r.hashed > maxHashedBytes {
				return ErrBad
			}
			h := sha256.Sum256(msg)
			next = h[:]
		case 0xf0, 0xf1:
			arg, err := r.varbytes(maxArg)
			if err != nil {
				return err
			}
			if tag == 0xf0 {
				next = append(append([]byte{}, msg...), arg...)
			} else {
				next = append(append([]byte{}, arg...), msg...)
			}
		default:
			return ErrBad
		}
		child, err := r.node(next, depth+1)
		if err != nil {
			return err
		}
		n.Next = append(n.Next, child)
		return nil
	}
	tag, err := r.byte1()
	if err != nil {
		return nil, err
	}
	for tag == 0xff {
		t, err := r.byte1()
		if err != nil {
			return nil, err
		}
		if err := one(t); err != nil {
			return nil, err
		}
		if tag, err = r.byte1(); err != nil {
			return nil, err
		}
	}
	if err := one(tag); err != nil {
		return nil, err
	}
	return n, nil
}

// Parse reads a raw timestamp tree for msg (calendar response format).
func Parse(b, msg []byte) (*Node, error) {
	if len(b) > MaxReceiptBytes {
		return nil, ErrBad
	}
	r := &reader{b: b}
	n, err := r.node(msg, 0)
	if err != nil {
		return nil, err
	}
	if r.i != len(b) {
		return nil, ErrBad
	}
	return n, nil
}

// Walk visits every node.
func (n *Node) Walk(fn func(*Node)) {
	fn(n)
	for _, c := range n.Next {
		c.Walk(fn)
	}
}

// PendingURIs lists calendar URIs of pending attestations.
func (n *Node) PendingURIs() []string {
	var out []string
	n.Walk(func(x *Node) {
		for _, a := range x.Attestations {
			if a.Pending != "" {
				out = append(out, a.Pending)
			}
		}
	})
	return out
}

// BitcoinHeight returns the lowest bitcoin attestation height (0 if none). A hint only — the
// browser verifies the block header.
func (n *Node) BitcoinHeight() uint64 {
	var best uint64
	n.Walk(func(x *Node) {
		for _, a := range x.Attestations {
			if a.Bitcoin > 0 && (best == 0 || a.Bitcoin < best) {
				best = a.Bitcoin
			}
		}
	})
	return best
}
