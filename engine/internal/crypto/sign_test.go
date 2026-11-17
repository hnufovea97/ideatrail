package crypto

import (
	"crypto/ed25519"
	"encoding/hex"
	"math/big"
	"strings"
	"testing"
)

var (
	rfc8032Seed = must(hex.DecodeString("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"))
	rfc8032Pub  = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
	// RFC 8032 §7.1 TEST 1: signature over the empty message.
	rfc8032EmptySig = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
)

var tCommit = strings.Repeat("ab", 32)

const tTime = "2026-11-14T05:12:03Z"

func TestRFC8032KnownAnswer(t *testing.T) {
	priv := ed25519.NewKeyFromSeed(rfc8032Seed)
	if hex.EncodeToString(priv.Public().(ed25519.PublicKey)) != rfc8032Pub {
		t.Fatal("public key mismatch")
	}
	sig := must(Sign(priv, nil))
	if hex.EncodeToString(must(UnB64(sig))) != rfc8032EmptySig {
		t.Fatal("signature mismatch")
	}
}

func TestRecordMessageLayout(t *testing.T) {
	r := Record{UserID: tUser, RootID: tRoot, RecordID: tRecord, Parents: []string{tOther, tUser}, CommitmentHex: tCommit,
		MetaSealed: []byte("m"), BodySealed: []byte("b"), NonceSealed: []byte("n"), LogSeq: 42, RecordedAt: tTime}
	want := strings.Join([]string{"ideatrail-v1-record", tUser, tRoot, tRecord, tUser + "," + tOther, tCommit,
		hexSHA([]byte("m")), hexSHA([]byte("b")), hexSHA([]byte("n")), "42", tTime}, "\n")
	if got := string(must(r.Message())); got != want {
		t.Fatalf("got %q", got)
	}
	r.Parents = nil
	if got := string(must(r.Message())); !strings.Contains(got, tRecord+"\n-\n"+tCommit) {
		t.Fatalf("no-parent case: %q", got)
	}
}

func TestEmptyFieldsBecomeDash(t *testing.T) {
	got := string(must(Approval{UserID: tUser, ApprovalID: tOther, ApprSeq: 1}.Message()))
	if got != "ideatrail-v1-approval\n"+tUser+"\n"+tOther+"\n-\n"+hexSHA(nil)+"\n1" {
		t.Fatalf("got %q", got)
	}
}

func TestSignVerifyAndTamper(t *testing.T) {
	priv := ed25519.NewKeyFromSeed(rfc8032Seed)
	pub := priv.Public().(ed25519.PublicKey)
	req := Request{Method: "POST", Path: "/v1/records?x=1", Body: []byte("{}"), EngineID: tOther, ReqSeq: 7, UnixTS: 1763097123}
	msg := must(req.Message())
	sig := must(Sign(priv, msg))
	if !Verify(pub, msg, sig) {
		t.Fatal("verify failed")
	}
	req.ReqSeq = 8
	if Verify(pub, must(req.Message()), sig) {
		t.Fatal("tampered seq verified")
	}
}

func TestVerifyRejectsMalformed(t *testing.T) {
	priv := ed25519.NewKeyFromSeed(rfc8032Seed)
	pub := priv.Public().(ed25519.PublicKey)
	msg := []byte("m")
	sig := must(Sign(priv, msg))
	raw := must(UnB64(sig))
	// S + L: same point, non-canonical scalar — strict verifiers reject it.
	l, _ := new(big.Int).SetString("7237005577332262213973186563042994240857116359379907606001950938285454250989", 10)
	s := new(big.Int).SetBytes(reverse(raw[32:]))
	s.Add(s, l)
	nonCanon := append(append([]byte{}, raw[:32]...), reverse(s.FillBytes(make([]byte, 32)))...)
	cases := map[string]bool{
		"short_pub":     Verify(pub[:31], msg, sig),
		"short_sig":     Verify(pub, msg, B64(raw[:63])),
		"bad_b64":       Verify(pub, msg, sig+"!"),
		"non_canonical": Verify(pub, msg, B64(nonCanon)),
	}
	for name, ok := range cases {
		if ok {
			t.Errorf("%s verified", name)
		}
	}
	if _, err := Sign(priv[:10], msg); err == nil {
		t.Error("short private key must error")
	}
}

func reverse(b []byte) []byte {
	out := make([]byte, len(b))
	for i := range b {
		out[len(b)-1-i] = b[i]
	}
	return out
}

func TestSignRejectsBadFields(t *testing.T) {
	cases := map[string]interface{ Message() ([]byte, error) }{
		"newline":       RepoHead{UserID: tUser, EngineID: tOther, CommitSHA: "a\nb", UnixTS: 1},
		"unit_sep":      Approval{UserID: tUser, ApprovalID: tOther, Kind: "a\x1fb"},
		"bad_user_id":   RepoHead{UserID: "u", EngineID: tOther, CommitSHA: "c", UnixTS: 1},
		"bad_parent_id": Record{UserID: tUser, RootID: tRoot, RecordID: tRecord, Parents: []string{"a,b"}, CommitmentHex: tCommit, RecordedAt: tTime},
		"dup_parent":    Record{UserID: tUser, RootID: tRoot, RecordID: tRecord, Parents: []string{tOther, tOther}, CommitmentHex: tCommit, RecordedAt: tTime},
		"short_commit":  Record{UserID: tUser, RootID: tRoot, RecordID: tRecord, CommitmentHex: "cc", RecordedAt: tTime},
		"bad_time":      Delta{UserID: tUser, RootID: tRoot, DeltaID: tRecord, CreatedAt: "2026-11-14 05:12:03"},
		"bad_sha":       RepoHead{UserID: tUser, EngineID: tOther, CommitSHA: "xyz", UnixTS: 1},
	}
	for name, m := range cases {
		if _, err := m.Message(); err != ErrBadField {
			t.Errorf("%s: got %v", name, err)
		}
	}
}

func FuzzVerify(f *testing.F) {
	priv := ed25519.NewKeyFromSeed(rfc8032Seed)
	pub := priv.Public().(ed25519.PublicKey)
	f.Add([]byte("m"), must(Sign(priv, []byte("m"))))
	f.Fuzz(func(t *testing.T, msg []byte, sig string) {
		_ = Verify(pub, msg, sig) // must never panic
		_ = Verify(pub[:len(msg)%33], msg, sig)
	})
}
