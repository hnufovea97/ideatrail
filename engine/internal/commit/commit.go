package commit

import (
	"crypto/sha256"
	"encoding/binary"
)

var tag = []byte("ideatrail/sha256-nonce-v1\x00")

// Commit은 설계문서 §3.1.10 A의 sha256-nonce-v1 지문을 계산한다.
func Commit(nonce, content []byte) [32]byte {
	h := sha256.New()
	h.Write(tag)
	var b4 [4]byte
	binary.BigEndian.PutUint32(b4[:], uint32(len(nonce)))
	h.Write(b4[:])
	h.Write(nonce)
	var b8 [8]byte
	binary.BigEndian.PutUint64(b8[:], uint64(len(content)))
	h.Write(b8[:])
	h.Write(content)
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}
