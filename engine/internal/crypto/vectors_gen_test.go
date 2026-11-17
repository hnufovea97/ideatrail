package crypto

// Deterministic shared test vectors (spec §14), test-only so none of this ships in the engine.
// `go test ./internal/crypto -run TestCommittedVectorsUpToDate -update` (make vectors) rewrites
// spec/vectors; without -update the test fails when committed files are stale.
// Browser-only primitives (relock, subkey, envelope) are computed here directly so TS output
// can be cross-checked against Go. Errors here are programming errors, so must() panics.

import (
	"crypto/ed25519"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"flag"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/cloudflare/circl/kem"

	"golang.org/x/crypto/chacha20poly1305"
)

type detReader struct {
	label []byte
	ctr   uint32
	buf   []byte
}

// det returns an endless SHA-256(label ‖ u32be(i)) stream.
func det(label string) *detReader { return &detReader{label: []byte(label)} }

func (d *detReader) Read(p []byte) (int, error) {
	for len(d.buf) < len(p) {
		var c [4]byte
		binary.BigEndian.PutUint32(c[:], d.ctr)
		d.ctr++
		h := sha256.Sum256(append(append([]byte{}, d.label...), c[:]...))
		d.buf = append(d.buf, h[:]...)
	}
	n := copy(p, d.buf)
	d.buf = d.buf[n:]
	return n, nil
}

func take(label string, n int) []byte {
	b := make([]byte, n)
	must(io.ReadFull(det(label), b))
	return b
}

func hx(b []byte) string { return hex.EncodeToString(b) }

var relockPurposes = []string{"account_priv", "root_meta", "prefs", "recall_notes", "reminder_state", "index_roots", "index_records", "engine_list", "export"}

const (
	vUser     = "01jcm3v8q7s2kx4f9d6b5n0tqw"
	vRoot     = "01jcm3v8q7s2kx4f9d6b5n0tqx"
	vRecord   = "01jcm3v8q7s2kx4f9d6b5n0tqy"
	vEnvelope = "01jcm3v8q7s2kx4f9d6b5n0tqz"
	vEngine   = "01jcm3v8q7s2kx4f9d6b5n0tr0"
	vApproval = "01jcm3v8q7s2kx4f9d6b5n0tr1"
	vMsg      = "01jcm3v8q7s2kx4f9d6b5n0tr2"
	vParentA  = "01jcm3v8q7s2kx4f9d6b5n0tr3"
	vParentB  = "01jcm3v8q7s2kx4f9d6b5n0tr4"
)

// BuildVectors returns every generated vector file keyed by file name.
func BuildVectors() (map[string][]byte, error) {
	gens := map[string]func() (any, error){
		"hpke_ideatrail.json": hpkeVectors,
		"pad.json":            padVectors,
		"ids.json":            idVectors,
		"sign.json":           signVectors,
		"subkey.json":         subkeyVectors,
		"xchacha.json":        xchachaVectors,
		"envelope.json":       envelopeVectors,
	}
	out := make(map[string][]byte, len(gens))
	for name, gen := range gens {
		v, err := gen()
		if err != nil {
			return nil, err
		}
		b, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return nil, err
		}
		out[name] = append(b, '\n')
	}
	return out, nil
}

func padVectors() (any, error) {
	type row struct {
		InputLen  int `json:"input_len"`
		PaddedLen int `json:"padded_len"`
	}
	rows := []row{}
	for _, n := range []int{0, 1, 255, 256, 4095, 4096, 9000} {
		rows = append(rows, row{n, len(Pad(make([]byte, n)))})
	}
	return map[string]any{"vectors": rows, "sample_input_hex": "41", "sample_padded_hex": hx(Pad([]byte("A")))}, nil
}

func idVectors() (any, error) {
	type row struct {
		Hex    string `json:"hex"`
		Base32 string `json:"base32"`
	}
	rows := []row{}
	for _, in := range [][]byte{{0x00}, {0x01}, {0x80}, take("id/1", 16), take("id/2", 16), take("id/3", 32), take("id/4", 5)} {
		rows = append(rows, row{hx(in), EncodeBase32(in)})
	}
	return map[string]any{"alphabet": crockford, "vectors": rows}, nil
}

func hpkeVectors() (any, error) {
	type row struct {
		Kind          int    `json:"kind"`
		KindName      string `json:"kind_name"`
		Mode          int    `json:"mode"`
		RecipientPriv string `json:"recipient_priv_hex"`
		RecipientPub  string `json:"recipient_pub_hex"`
		SenderPriv    string `json:"sender_priv_hex,omitempty"`
		SenderPub     string `json:"sender_pub_hex,omitempty"`
		UserID        string `json:"user_id"`
		RootID        string `json:"root_id"`
		RecordID      string `json:"record_id"`
		Version       string `json:"version"`
		AADHex        string `json:"aad_hex"`
		PlaintextHex  string `json:"plaintext_hex"`
		SealedHex     string `json:"sealed_hex"`
	}
	skR, pkR, err := GenerateKEMKey(det("recipient"))
	if err != nil {
		return nil, err
	}
	skS, pkS, err := GenerateKEMKey(det("sender"))
	if err != nil {
		return nil, err
	}
	rb := must(skR.MarshalBinary())
	rp := must(pkR.MarshalBinary())
	sb := must(skS.MarshalBinary())
	sp := must(pkS.MarshalBinary())
	rows := []row{}
	for k := KindRecordMeta; k <= KindFolderSuggestions; k++ {
		name := must(k.Name())
		a := AAD{UserID: vUser, RootID: vRoot, RecordID: vRecord, Version: "0"}
		switch k {
		case KindEngineInbox:
			a = AAD{UserID: vUser, RootID: vApproval, RecordID: vMsg}
		case KindPairingPayload, KindDeviceAddMaster:
			a = AAD{UserID: vUser}
		}
		pt := []byte(`{"kind":"` + name + `"}`)
		var sender kem.PrivateKey
		mode := 0
		if k == KindEngineInbox {
			sender, mode = skS, modeAuth
		}
		sealed, err := seal(det("eph/"+name), k, pkR, sender, a, pt)
		if err != nil {
			return nil, err
		}
		aad := must(BuildAAD(name, a))
		r := row{Kind: int(k), KindName: name, Mode: mode, RecipientPriv: hx(rb), RecipientPub: hx(rp),
			UserID: a.UserID, RootID: a.RootID, RecordID: a.RecordID, Version: a.Version,
			AADHex: hx(aad), PlaintextHex: hx(pt), SealedHex: hx(sealed)}
		if mode == modeAuth {
			r.SenderPriv, r.SenderPub = hx(sb), hx(sp)
		}
		rows = append(rows, r)
	}
	return map[string]any{"suite": "DHKEM(X25519,HKDF-SHA256)/HKDF-SHA256/ChaCha20Poly1305", "vectors": rows}, nil
}

type signCase struct {
	name  string
	input map[string]string // snake_case; bytes as hex, numbers as decimal strings
	msg   interface{ Message() ([]byte, error) }
}

const bigSeq = uint64(1)<<63 + 5 // above 2^53: JSON numbers would lose it, so all numbers are strings

func signCases() []signCase {
	commit := hx(take("commitment", 32))
	return []signCase{
		{"request", map[string]string{"method": "POST", "path": "/v1/records?x=1", "body_hex": hx([]byte(`{"a":1}`)), "engine_id": vEngine, "req_seq": u64(bigSeq), "unix_ts": "1763097123"},
			Request{Method: "POST", Path: "/v1/records?x=1", Body: []byte(`{"a":1}`), EngineID: vEngine, ReqSeq: bigSeq, UnixTS: 1763097123}},
		{"record_no_parent", map[string]string{"user_id": vUser, "root_id": vRoot, "record_id": vRecord, "parents": "", "commitment_hex": commit, "meta_sealed_hex": "6d", "body_sealed_hex": "62", "nonce_sealed_hex": "6e", "log_seq": "1", "recorded_at": "2026-11-14T05:12:03Z"},
			Record{UserID: vUser, RootID: vRoot, RecordID: vRecord, CommitmentHex: commit, MetaSealed: []byte("m"), BodySealed: []byte("b"), NonceSealed: []byte("n"), LogSeq: 1, RecordedAt: "2026-11-14T05:12:03Z"}},
		{"record_two_parents", map[string]string{"user_id": vUser, "root_id": vRoot, "record_id": vRecord, "parents": vParentB + "," + vParentA, "commitment_hex": commit, "meta_sealed_hex": "6d", "body_sealed_hex": "62", "nonce_sealed_hex": "6e", "log_seq": "2", "recorded_at": "2026-11-14T05:12:04Z"},
			Record{UserID: vUser, RootID: vRoot, RecordID: vRecord, Parents: []string{vParentB, vParentA}, CommitmentHex: commit, MetaSealed: []byte("m"), BodySealed: []byte("b"), NonceSealed: []byte("n"), LogSeq: 2, RecordedAt: "2026-11-14T05:12:04Z"}},
		{"delta", map[string]string{"user_id": vUser, "root_id": vRoot, "delta_id": vRecord, "delta_sealed_hex": "64", "log_seq": "3", "created_at": "2026-11-14T05:12:05Z"},
			Delta{UserID: vUser, RootID: vRoot, DeltaID: vRecord, DeltaSealed: []byte("d"), LogSeq: 3, CreatedAt: "2026-11-14T05:12:05Z"}},
		{"storage_link", map[string]string{"user_id": vUser, "engine_id": vEngine, "token_sealed_hex": "74", "unix_ts": "1763097123"},
			StorageLink{UserID: vUser, EngineID: vEngine, TokenSealed: []byte("t"), UnixTS: 1763097123}},
		{"repo_head", map[string]string{"user_id": vUser, "engine_id": vEngine, "commit_sha": "0123456789abcdef0123456789abcdef01234567", "unix_ts": "1763097123"},
			RepoHead{UserID: vUser, EngineID: vEngine, CommitSHA: "0123456789abcdef0123456789abcdef01234567", UnixTS: 1763097123}},
		{"approval", map[string]string{"user_id": vUser, "approval_id": vApproval, "kind": "signup_select", "summary_sealed_hex": "73", "appr_seq": "1"},
			Approval{UserID: vUser, ApprovalID: vApproval, Kind: "signup_select", SummarySealed: []byte("s"), ApprSeq: 1}},
	}
}

func signVectors() (any, error) {
	seed := must(hex.DecodeString("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"))
	priv := ed25519.NewKeyFromSeed(seed)
	type row struct {
		Name       string            `json:"name"`
		Input      map[string]string `json:"input"`
		MessageHex string            `json:"message_hex"`
		SigB64u    string            `json:"signature_b64u"`
	}
	rows := []row{}
	for _, c := range signCases() {
		msg, err := c.msg.Message()
		if err != nil {
			return nil, err
		}
		sig, err := Sign(priv, msg)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row{c.name, c.input, hx(msg), sig})
	}
	return map[string]any{"seed_hex": hx(seed), "public_hex": hx(priv.Public().(ed25519.PublicKey)), "vectors": rows}, nil
}

func hkdf32(ikm, salt []byte, info string) []byte {
	return must(hkdf.Key(sha256.New, ikm, salt, info, 32))
}

func subkeyOf(mk []byte, purpose string) []byte {
	return hkdf32(mk, nil, "ideatrail/v1/subkey/"+purpose)
}

func subkeyVectors() (any, error) {
	mk := take("mk", 32)
	keys := map[string]string{}
	for _, p := range append(slices.Clone(relockPurposes), "record/"+vRecord) {
		keys[p] = hx(subkeyOf(mk, p))
	}
	return map[string]any{"mk_hex": hx(mk), "subkeys": keys}, nil
}

func relockBytes(key []byte, kindByte byte, nonce, aad, pt []byte) ([]byte, error) {
	a, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, err
	}
	out := append(append(append([]byte{}, magic...), kindByte), nonce...)
	return a.Seal(out, nonce, Pad(pt), aad), nil
}

func joinAAD(fields ...string) []byte { return []byte(strings.Join(fields, sepAAD)) }

// draft-irtf-cfrg-xchacha-03 §A.3.1 inputs.
var xchachaStd = map[string]string{
	"key_hex":   "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f",
	"nonce_hex": "404142434445464748494a4b4c4d4e4f5051525354555657",
	"aad_hex":   "50515253c0c1c2c3c4c5c6c7",
	"plaintext": "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
}

func xchachaVectors() (any, error) {
	k := must(hex.DecodeString(xchachaStd["key_hex"]))
	n := must(hex.DecodeString(xchachaStd["nonce_hex"]))
	ad := must(hex.DecodeString(xchachaStd["aad_hex"]))
	a, err := chacha20poly1305.NewX(k)
	if err != nil {
		return nil, err
	}
	std := map[string]string{
		"key_hex": xchachaStd["key_hex"], "nonce_hex": xchachaStd["nonce_hex"], "aad_hex": xchachaStd["aad_hex"],
		"plaintext_hex": hx([]byte(xchachaStd["plaintext"])), "ciphertext_and_tag_hex": hx(a.Seal(nil, n, []byte(xchachaStd["plaintext"]), ad)),
	}
	mk := take("mk", 32)
	type row struct {
		Purpose   string `json:"purpose"`
		KindByte  int    `json:"kind_byte"`
		UserID    string `json:"user_id"`
		RootID    string `json:"root_id"`
		NonceHex  string `json:"nonce_hex"`
		AADHex    string `json:"aad_hex"`
		Plaintext string `json:"plaintext_hex"`
		Sealed    string `json:"sealed_hex"`
	}
	rows := []row{}
	for i, p := range relockPurposes {
		nonce := take("nonce/"+p, 24)
		aad := joinAAD("IT1", p, vUser, vRoot, "-", "-", CryptoVersion)
		pt := []byte(`{"p":"` + p + `"}`)
		kb := byte(0x80 + i + 1)
		sealed, err := relockBytes(subkeyOf(mk, p), kb, nonce, aad, pt)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row{p, int(kb), vUser, vRoot, hx(nonce), hx(aad), hx(pt), hx(sealed)})
	}
	return map[string]any{"standard": std, "mk_hex": hx(mk), "ours": rows}, nil
}

func envelopeVectors() (any, error) {
	salt := sha256.Sum256([]byte("ideatrail/v1/prf-salt"))
	prf, cred, mk := take("prf", 32), take("cred", 16), take("mk", 32)
	wrap := hkdf32(prf, []byte("ideatrail/v1/prf-wrap"), string(cred))
	nonce := take("env-nonce", 24)
	aad := joinAAD("IT1", "envelope", vUser, vEnvelope, CryptoVersion)
	env, err := relockBytes(wrap, 0x80, nonce, aad, mk)
	if err != nil {
		return nil, err
	}
	rk := take("rk", 32)
	rwrap := hkdf32(rk, []byte("ideatrail/v1/recovery-wrap"), vUser)
	rnonce := take("rec-nonce", 24)
	renv, err := relockBytes(rwrap, 0x80, rnonce, aad, mk)
	if err != nil {
		return nil, err
	}
	lookupID := hx(hkdf32(rk, []byte("ideatrail/v1/recovery-lookup"), ""))[:32]
	verifyKey := ed25519.NewKeyFromSeed(hkdf32(rk, []byte("ideatrail/v1/recovery-verify"), ""))
	const proofChallenge = "dGVzdC1jaGFsbGVuZ2U"
	proofSig := ed25519.Sign(verifyKey, []byte("ideatrail/v1/recovery-proof\n"+proofChallenge))
	lh := sha256.Sum256([]byte(lookupID))
	disp := EncodeBase32(rk)
	groups := make([]string, 0, 13)
	for i := 0; i < len(disp); i += 4 {
		groups = append(groups, disp[i:i+4])
	}
	return map[string]any{
		"prf_salt_hex": hx(salt[:]), "prf_output_hex": hx(prf), "credential_id_hex": hx(cred),
		"user_id": vUser, "envelope_id": vEnvelope, "mk_hex": hx(mk),
		"wrap_hex": hx(wrap), "nonce_hex": hx(nonce), "aad_hex": hx(aad), "envelope_hex": hx(env),
		"recovery": map[string]string{
			"rk_hex": hx(rk), "rk_display": strings.Join(groups, "-"), "wrap_hex": hx(rwrap), "nonce_hex": hx(rnonce),
			"envelope_hex": hx(renv), "lookup_id": lookupID, "lookup_hash": hx(lh[:]),
			"verify_pub_hex": hx(verifyKey.Public().(ed25519.PublicKey)), "proof_challenge": proofChallenge, "proof_sig_hex": hx(proofSig),
		},
	}, nil
}

const vectorsDir = "../../../spec/vectors"

var update = flag.Bool("update", false, "rewrite spec/vectors from the generator")

func TestCommittedVectorsUpToDate(t *testing.T) {
	files, err := BuildVectors()
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		path := filepath.Join(vectorsDir, name)
		if *update {
			if err := os.WriteFile(path, files[name], 0o644); err != nil {
				t.Fatal(err)
			}
			t.Logf("wrote %s", name)
			continue
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%s: %v (run: make vectors)", name, err)
		}
		if string(got) != string(files[name]) {
			t.Errorf("%s is stale — run: make vectors", name)
		}
	}
}
