package crypto

import (
	"crypto/ed25519"
	"errors"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// ErrBadKey means a key was nil, of the wrong type, or the wrong length.
var ErrBadKey = errors.New("bad_key")

var (
	sha256HexRe = regexp.MustCompile(`^[0-9a-f]{64}$`)
	commitSHARe = regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`) // git SHA-1 or SHA-256
	timeRe      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`)
)

// matchField validates a non-empty field against re.
func matchField(re *regexp.Regexp, s string) error {
	if !re.MatchString(s) {
		return ErrBadField
	}
	return nil
}

// Request is the signed API request (spec §8).
type Request struct {
	Method, Path string
	Body         []byte
	EngineID     string
	ReqSeq       uint64
	UnixTS       int64
}

// Record is the signed record header (spec §8).
type Record struct {
	UserID, RootID, RecordID            string
	Parents                             []string
	CommitmentHex                       string
	MetaSealed, BodySealed, NonceSealed []byte
	LogSeq                              uint64
	RecordedAt                          string
}

// Delta is the signed metadata delta (spec §8).
type Delta struct {
	UserID, RootID, DeltaID string
	DeltaSealed             []byte
	LogSeq                  uint64
	CreatedAt               string
}

// StorageLink binds the sealed GitHub token to the engine (spec §8).
type StorageLink struct {
	UserID, EngineID string
	TokenSealed      []byte
	UnixTS           int64
}

// RepoHead is the signed repository head (spec §8).
type RepoHead struct {
	UserID, EngineID, CommitSHA string
	UnixTS                      int64
}

// Approval is the signed approval request (spec §8).
type Approval struct {
	UserID, ApprovalID, Kind string
	SummarySealed            []byte
	ApprSeq                  uint64
}

func u64(n uint64) string { return strconv.FormatUint(n, 10) }
func i64(n int64) string  { return strconv.FormatInt(n, 10) }

// ids validates each value as an id field, in order.
func ids(vals ...string) ([]string, error) {
	out := make([]string, len(vals))
	for i, v := range vals {
		f, err := idField(v)
		if err != nil {
			return nil, err
		}
		out[i] = f
	}
	return out, nil
}

func signMsg(fields ...string) ([]byte, error) {
	dashed := make([]string, len(fields))
	for i, f := range fields {
		dashed[i] = orDash(f)
	}
	s, err := joinFields(sepSign, dashed)
	if err != nil {
		return nil, err
	}
	return []byte(s), nil
}

func joinParents(ps []string) (string, error) {
	if len(ps) == 0 {
		return "-", nil
	}
	sorted := slices.Clone(ps)
	for _, p := range sorted {
		if _, err := idField(p); err != nil || p == "" || p == "-" {
			return "", ErrBadField
		}
	}
	slices.Sort(sorted)
	if len(slices.Compact(slices.Clone(sorted))) != len(sorted) {
		return "", ErrBadField // duplicate parent
	}
	return strings.Join(sorted, ","), nil
}

func (r Request) Message() ([]byte, error) {
	f, err := ids(r.EngineID)
	if err != nil {
		return nil, err
	}
	return signMsg("ideatrail-v1-req", r.Method, r.Path, hexSHA(r.Body), f[0], u64(r.ReqSeq), i64(r.UnixTS))
}

func (r Record) Message() ([]byte, error) {
	f, err := ids(r.UserID, r.RootID, r.RecordID)
	if err != nil {
		return nil, err
	}
	parents, err := joinParents(r.Parents)
	if err != nil {
		return nil, err
	}
	if err := errors.Join(matchField(sha256HexRe, r.CommitmentHex), matchField(timeRe, r.RecordedAt)); err != nil {
		return nil, ErrBadField
	}
	return signMsg("ideatrail-v1-record", f[0], f[1], f[2], parents, r.CommitmentHex,
		hexSHA(r.MetaSealed), hexSHA(r.BodySealed), hexSHA(r.NonceSealed), u64(r.LogSeq), r.RecordedAt)
}

func (d Delta) Message() ([]byte, error) {
	f, err := ids(d.UserID, d.RootID, d.DeltaID)
	if err != nil {
		return nil, err
	}
	if err := matchField(timeRe, d.CreatedAt); err != nil {
		return nil, err
	}
	return signMsg("ideatrail-v1-delta", f[0], f[1], f[2], hexSHA(d.DeltaSealed), u64(d.LogSeq), d.CreatedAt)
}

func (s StorageLink) Message() ([]byte, error) {
	f, err := ids(s.UserID, s.EngineID)
	if err != nil {
		return nil, err
	}
	return signMsg("ideatrail-v1-storagelink", f[0], f[1], hexSHA(s.TokenSealed), i64(s.UnixTS))
}

func (h RepoHead) Message() ([]byte, error) {
	f, err := ids(h.UserID, h.EngineID)
	if err != nil {
		return nil, err
	}
	if err := matchField(commitSHARe, h.CommitSHA); err != nil {
		return nil, err
	}
	return signMsg("ideatrail-v1-repohead", f[0], f[1], h.CommitSHA, i64(h.UnixTS))
}

func (a Approval) Message() ([]byte, error) {
	f, err := ids(a.UserID, a.ApprovalID)
	if err != nil {
		return nil, err
	}
	return signMsg("ideatrail-v1-approval", f[0], f[1], a.Kind, hexSHA(a.SummarySealed), u64(a.ApprSeq))
}

// Sign returns a base64url Ed25519 signature.
func Sign(priv ed25519.PrivateKey, msg []byte) (string, error) {
	if len(priv) != ed25519.PrivateKeySize {
		return "", ErrBadKey
	}
	return B64(ed25519.Sign(priv, msg)), nil
}

// Verify checks a base64url Ed25519 signature; malformed input returns false, never panics.
func Verify(pub ed25519.PublicKey, msg []byte, sig string) bool {
	if len(pub) != ed25519.PublicKeySize {
		return false
	}
	b, err := UnB64(sig)
	return err == nil && len(b) == ed25519.SignatureSize && ed25519.Verify(pub, msg, b)
}
