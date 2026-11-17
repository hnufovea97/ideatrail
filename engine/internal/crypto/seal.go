package crypto

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"

	"github.com/cloudflare/circl/hpke"
	"github.com/cloudflare/circl/kem"
)

// Kind is the sealed blob type byte (spec §4).
type Kind byte

const (
	KindRecordMeta        Kind = 1
	KindRecordBody        Kind = 2
	KindOriginal          Kind = 3
	KindDelta             Kind = 4
	KindNonce             Kind = 5
	KindStorageToken      Kind = 6
	KindEngineInbox       Kind = 7
	KindPairingPayload    Kind = 8
	KindDeviceAddMaster   Kind = 9
	KindApprovalSummary   Kind = 10
	KindFolderSuggestions Kind = 11
)

var kindNames = map[Kind]string{
	KindRecordMeta: "record_meta", KindRecordBody: "record_body", KindOriginal: "original",
	KindDelta: "delta", KindNonce: "nonce", KindStorageToken: "storage_token",
	KindEngineInbox: "engine_inbox", KindPairingPayload: "pairing_payload",
	KindDeviceAddMaster: "device_add_master", KindApprovalSummary: "approval_summary",
	KindFolderSuggestions: "folder_suggestions",
}

var (
	ErrUnknownKind = errors.New("unknown_kind")
	// ErrAuthMode means kind 7 was used with base mode, or another kind with Auth mode.
	ErrAuthMode = errors.New("auth_mode_mismatch")
	// ErrDecrypt is the single error for every failure to open a blob (no oracle).
	ErrDecrypt = errors.New("decrypt_failed")
)

const modeAuth = 2 // RFC 9180 mode_auth, used only for kind 7

const (
	encLen = 32
	tagLen = 16
)

var (
	suite     = hpke.NewSuite(hpke.KEM_X25519_HKDF_SHA256, hpke.KDF_HKDF_SHA256, hpke.AEAD_ChaCha20Poly1305)
	kemScheme = hpke.KEM_X25519_HKDF_SHA256.Scheme()
)

// AAD holds the variable AAD fields; empty fields become "-" (spec §2, §4).
// For kind 7, RootID carries approval_id and RecordID carries msg_id.
type AAD struct{ UserID, RootID, RecordID, Version string }

// Name returns the spec kind_name.
func (k Kind) Name() (string, error) {
	n, ok := kindNames[k]
	if !ok {
		return "", ErrUnknownKind
	}
	return n, nil
}

// BuildAAD joins IT1, name, the validated fields and crypto_version with 0x1F.
func BuildAAD(name string, a AAD) ([]byte, error) {
	fields := []string{"IT1", name}
	for _, f := range []struct {
		v     string
		check func(string) (string, error)
	}{{a.UserID, idField}, {a.RootID, idField}, {a.RecordID, idField}, {a.Version, numField}} {
		v, err := f.check(f.v)
		if err != nil {
			return nil, err
		}
		fields = append(fields, v)
	}
	s, err := joinFields(sepAAD, append(fields, CryptoVersion))
	if err != nil {
		return nil, err
	}
	return []byte(s), nil
}

// GenerateKEMKey derives an X25519 key pair from 32 bytes read from r.
func GenerateKEMKey(r io.Reader) (kem.PrivateKey, kem.PublicKey, error) {
	seed := make([]byte, kemScheme.SeedSize())
	if _, err := io.ReadFull(r, seed); err != nil {
		return nil, nil, err
	}
	pub, priv := kemScheme.DeriveKeyPair(seed)
	return priv, pub, nil
}

// ParseKEMPrivate parses a 32-byte X25519 private key.
func ParseKEMPrivate(b []byte) (kem.PrivateKey, error) { return kemScheme.UnmarshalBinaryPrivateKey(b) }

// ParseKEMPublic parses a 32-byte X25519 public key.
func ParseKEMPublic(b []byte) (kem.PublicKey, error) { return kemScheme.UnmarshalBinaryPublicKey(b) }

// isX25519 reports whether k is a non-nil key of our KEM scheme (circl panics on foreign or nil keys).
func isX25519(k interface{ Scheme() kem.Scheme }) bool {
	return k != nil && k.Scheme() == kemScheme
}

func prepare(kind Kind, a AAD, auth bool) (info, aad []byte, err error) {
	name, err := kind.Name()
	if err != nil {
		return nil, nil, err
	}
	if auth != (kind == KindEngineInbox) {
		return nil, nil, ErrAuthMode
	}
	aad, err = BuildAAD(name, a)
	return []byte("ideatrail/v1/" + name), aad, err
}

// Seal encrypts to recipient in HPKE base mode (every kind except 7).
func Seal(kind Kind, recipient kem.PublicKey, a AAD, plaintext []byte) ([]byte, error) {
	return seal(rand.Reader, kind, recipient, nil, a, plaintext)
}

// SealAuth encrypts kind 7 in HPKE Auth mode; sender is the account private key.
func SealAuth(kind Kind, recipient kem.PublicKey, sender kem.PrivateKey, a AAD, plaintext []byte) ([]byte, error) {
	if sender == nil {
		return nil, ErrAuthMode
	}
	return seal(rand.Reader, kind, recipient, sender, a, plaintext)
}

// seal takes an explicit randomness source; only the vector generator passes a deterministic one.
func seal(rnd io.Reader, kind Kind, recipient kem.PublicKey, sender kem.PrivateKey, a AAD, plaintext []byte) ([]byte, error) {
	info, aad, err := prepare(kind, a, sender != nil)
	if err != nil {
		return nil, err
	}
	if !isX25519(recipient) || (sender != nil && !isX25519(sender)) {
		return nil, ErrBadKey
	}
	snd, err := suite.NewSender(recipient, info)
	if err != nil {
		return nil, err
	}
	var enc []byte
	var sealer hpke.Sealer
	if sender != nil {
		enc, sealer, err = snd.SetupAuth(rnd, sender)
	} else {
		enc, sealer, err = snd.Setup(rnd)
	}
	if err != nil {
		return nil, fmt.Errorf("hpke setup: %w", err)
	}
	if kind != KindOriginal {
		plaintext = Pad(plaintext)
	}
	ct, err := sealer.Seal(plaintext, aad)
	if err != nil {
		return nil, fmt.Errorf("hpke seal: %w", err)
	}
	out := make([]byte, 0, headerLen+len(enc)+len(ct))
	out = append(append(append(append(out, magic...), byte(kind)), enc...), ct...)
	return out, nil
}

// Open decrypts a base-mode blob of the expected kind.
func Open(kind Kind, recipient kem.PrivateKey, a AAD, blob []byte) ([]byte, error) {
	return open(kind, recipient, nil, a, blob)
}

// OpenAuth decrypts a kind 7 blob and proves it came from senderPub.
func OpenAuth(kind Kind, recipient kem.PrivateKey, senderPub kem.PublicKey, a AAD, blob []byte) ([]byte, error) {
	if senderPub == nil {
		return nil, ErrAuthMode
	}
	return open(kind, recipient, senderPub, a, blob)
}

func open(kind Kind, recipient kem.PrivateKey, senderPub kem.PublicKey, a AAD, blob []byte) ([]byte, error) {
	info, aad, err := prepare(kind, a, senderPub != nil)
	if err != nil {
		return nil, err
	}
	if !isX25519(recipient) || (senderPub != nil && !isX25519(senderPub)) {
		return nil, ErrBadKey
	}
	pt, err := decrypt(kind, recipient, senderPub, info, aad, blob)
	if err != nil {
		return nil, ErrDecrypt
	}
	return pt, nil
}

func decrypt(kind Kind, recipient kem.PrivateKey, senderPub kem.PublicKey, info, aad, blob []byte) ([]byte, error) {
	if len(blob) < headerLen+encLen+tagLen || string(blob[:len(magic)]) != magic || blob[len(magic)] != byte(kind) {
		return nil, ErrDecrypt
	}
	enc, ct := blob[headerLen:headerLen+encLen], blob[headerLen+encLen:]
	rcv, err := suite.NewReceiver(recipient, info)
	if err != nil {
		return nil, err
	}
	var opener hpke.Opener
	if senderPub != nil {
		opener, err = rcv.SetupAuth(enc, senderPub)
	} else {
		opener, err = rcv.Setup(enc)
	}
	if err != nil {
		return nil, err
	}
	pt, err := opener.Open(ct, aad)
	if err != nil {
		return nil, err
	}
	if kind == KindOriginal {
		return pt, nil
	}
	return Unpad(pt)
}
