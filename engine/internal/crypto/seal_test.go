package crypto

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	"github.com/cloudflare/circl/hpke"
	"github.com/cloudflare/circl/kem"
)

const (
	tUser   = "01jcm3v8q7s2kx4f9d6b5n0tqw"
	tRoot   = "01jcm3v8q7s2kx4f9d6b5n0tqx"
	tRecord = "01jcm3v8q7s2kx4f9d6b5n0tqy"
	tOther  = "01jcm3v8q7s2kx4f9d6b5n0tqz"
)

type rfcVector struct {
	Mode        int    `json:"mode"`
	Info        string `json:"info"`
	IkmE        string `json:"ikmE"`
	SkRm        string `json:"skRm"`
	PkRm        string `json:"pkRm"`
	SkSm        string `json:"skSm"`
	PkSm        string `json:"pkSm"`
	Enc         string `json:"enc"`
	Encryptions []struct {
		Aad string `json:"aad"`
		Ct  string `json:"ct"`
		Pt  string `json:"pt"`
	} `json:"encryptions"`
}

func unhex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// must panics on error; a panic fails the running test with the error message.
func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

func TestRFC9180Vectors(t *testing.T) {
	var vs []rfcVector
	if err := json.Unmarshal(must(os.ReadFile("../../../spec/vectors/hpke_rfc9180.json")), &vs); err != nil {
		t.Fatal(err)
	}
	if len(vs) < 2 {
		t.Fatal("expected base and auth vectors")
	}
	for _, v := range vs {
		pkR := must(ParseKEMPublic(unhex(t, v.PkRm)))
		skR := must(ParseKEMPrivate(unhex(t, v.SkRm)))
		info := unhex(t, v.Info)
		snd := must(suite.NewSender(pkR, info))
		rcv := must(suite.NewReceiver(skR, info))
		var enc []byte
		var sealer hpke.Sealer
		var opener hpke.Opener
		var err error
		if v.Mode == 2 {
			skS := must(ParseKEMPrivate(unhex(t, v.SkSm)))
			pkS := must(ParseKEMPublic(unhex(t, v.PkSm)))
			enc, sealer, err = snd.SetupAuth(bytes.NewReader(unhex(t, v.IkmE)), skS)
			if err == nil {
				opener, err = rcv.SetupAuth(enc, pkS)
			}
		} else {
			enc, sealer, err = snd.Setup(bytes.NewReader(unhex(t, v.IkmE)))
			if err == nil {
				opener, err = rcv.Setup(enc)
			}
		}
		if err != nil || hex.EncodeToString(enc) != v.Enc {
			t.Fatalf("mode %d: enc mismatch (%v)", v.Mode, err)
		}
		for i, e := range v.Encryptions {
			ct := must(sealer.Seal(unhex(t, e.Pt), unhex(t, e.Aad)))
			if hex.EncodeToString(ct) != e.Ct {
				t.Fatalf("mode %d #%d: ct mismatch", v.Mode, i)
			}
			pt, err := opener.Open(ct, unhex(t, e.Aad))
			if err != nil || hex.EncodeToString(pt) != e.Pt {
				t.Fatalf("mode %d #%d: open %v", v.Mode, i, err)
			}
		}
	}
}

func goodAAD() AAD { return AAD{UserID: tUser, RootID: tRoot, RecordID: tRecord, Version: "0"} }

func TestSealLayoutAndRoundTrip(t *testing.T) {
	skR, pkR := must2(t)
	sealed := must(Seal(KindRecordMeta, pkR, goodAAD(), []byte(`{"t":1}`)))
	if string(sealed[:3]) != magic || sealed[3] != byte(KindRecordMeta) || len(sealed) != 4+32+256+16 {
		t.Fatalf("bad layout len=%d", len(sealed))
	}
	if pt, err := Open(KindRecordMeta, skR, goodAAD(), sealed); err != nil || string(pt) != `{"t":1}` {
		t.Fatalf("open: %v %q", err, pt)
	}
}

func must2(t *testing.T) (skR kem.PrivateKey, pkR kem.PublicKey) {
	t.Helper()
	sk, pk, err := GenerateKEMKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return sk, pk
}

func TestMovedCiphertextFails(t *testing.T) {
	skR, pkR := must2(t)
	sealed := must(Seal(KindRecordMeta, pkR, goodAAD(), []byte("x")))
	changes := map[string]AAD{
		"user_id":   {UserID: tOther, RootID: tRoot, RecordID: tRecord, Version: "0"},
		"root_id":   {UserID: tUser, RootID: tOther, RecordID: tRecord, Version: "0"},
		"record_id": {UserID: tUser, RootID: tRoot, RecordID: tOther, Version: "0"},
		"version":   {UserID: tUser, RootID: tRoot, RecordID: tRecord, Version: "1"},
	}
	for name, a := range changes {
		if _, err := Open(KindRecordMeta, skR, a, sealed); err != ErrDecrypt {
			t.Errorf("%s change: want ErrDecrypt, got %v", name, err)
		}
	}
	flipped := bytes.Clone(sealed)
	flipped[3] = byte(KindRecordBody)
	if _, err := Open(KindRecordBody, skR, goodAAD(), flipped); err != ErrDecrypt {
		t.Error("kind_name change must fail")
	}
	if _, err := Open(KindRecordBody, skR, goodAAD(), sealed); err != ErrDecrypt {
		t.Error("wrong expected kind must fail")
	}
}

func TestMalformedBlobs(t *testing.T) {
	skR, pkR := must2(t)
	sealed := must(Seal(KindDelta, pkR, goodAAD(), []byte("x")))
	badMagic := bytes.Clone(sealed)
	badMagic[0] = 'X'
	zeroEnc := bytes.Clone(sealed)
	copy(zeroEnc[4:36], make([]byte, 32))
	for name, b := range map[string][]byte{
		"empty": nil, "truncated": sealed[:40], "short_enc": sealed[:4+31], "bad_magic": badMagic, "zero_enc": zeroEnc,
	} {
		if _, err := Open(KindDelta, skR, goodAAD(), b); err != ErrDecrypt {
			t.Errorf("%s: want ErrDecrypt, got %v", name, err)
		}
	}
	// circl accepts the all-zero point as bytes; sealing to it must still fail (low-order point).
	zero := must(ParseKEMPublic(make([]byte, 32)))
	if _, err := Seal(KindDelta, zero, goodAAD(), []byte("x")); err == nil {
		t.Error("seal to all-zero public key must fail")
	}
}

func TestBadAADFields(t *testing.T) {
	_, pkR := must2(t)
	for name, a := range map[string]AAD{
		"short_id":  {UserID: "u"},
		"upper_id":  {UserID: "01JCM3V8Q7S2KX4F9D6B5N0TQW"},
		"separator": {UserID: tUser, Version: "0\x1f"},
		"version":   {UserID: tUser, Version: "v1"},
	} {
		if _, err := Seal(KindDelta, pkR, a, []byte("x")); err != ErrBadField {
			t.Errorf("%s: want ErrBadField, got %v", name, err)
		}
	}
}

func TestOriginalNotPadded(t *testing.T) {
	skR, pkR := must2(t)
	sealed := must(Seal(KindOriginal, pkR, goodAAD(), []byte("abc")))
	if len(sealed) != 4+32+3+16 {
		t.Fatalf("len=%d", len(sealed))
	}
	if pt, err := Open(KindOriginal, skR, goodAAD(), sealed); err != nil || string(pt) != "abc" {
		t.Fatal(err)
	}
}

func TestAuthModeSplit(t *testing.T) {
	skR, pkR := must2(t)
	skS, pkS := must2(t)
	_, otherPub := must2(t)
	a := AAD{UserID: tUser, RootID: tOther, RecordID: tRecord}
	if _, err := Seal(KindEngineInbox, pkR, a, []byte("x")); err != ErrAuthMode {
		t.Fatal("kind 7 via base Seal must fail")
	}
	if _, err := SealAuth(KindRecordMeta, pkR, skS, a, []byte("x")); err != ErrAuthMode {
		t.Fatal("SealAuth on non-7 kind must fail")
	}
	sealed := must(SealAuth(KindEngineInbox, pkR, skS, a, []byte("x")))
	if _, err := OpenAuth(KindEngineInbox, skR, pkS, a, sealed); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenAuth(KindEngineInbox, skR, otherPub, a, sealed); err != ErrDecrypt {
		t.Fatal("wrong sender must fail")
	}
	if _, err := Open(KindEngineInbox, skR, a, sealed); err != ErrAuthMode {
		t.Fatal("kind 7 via base Open must fail")
	}
}

func TestSealEncNeverRepeats(t *testing.T) {
	_, pkR := must2(t)
	seen := map[string]bool{}
	for i := 0; i < 10000; i++ {
		s := must(Seal(KindNonce, pkR, goodAAD(), []byte("n")))
		k := string(s[4:36])
		if seen[k] {
			t.Fatal("ephemeral key reused")
		}
		seen[k] = true
	}
}

func TestNilOrForeignKeysAreRejected(t *testing.T) {
	skR, pkR := must2(t)
	sealed := must(Seal(KindDelta, pkR, goodAAD(), []byte("x")))
	if _, err := Seal(KindDelta, nil, goodAAD(), []byte("x")); err != ErrBadKey {
		t.Errorf("nil recipient: %v", err)
	}
	if _, err := SealAuth(KindEngineInbox, pkR, nil, AAD{}, []byte("x")); err != ErrAuthMode {
		t.Errorf("nil sender: %v", err)
	}
	if _, err := Open(KindDelta, nil, goodAAD(), sealed); err != ErrBadKey {
		t.Errorf("nil recipient on open: %v", err)
	}
	if _, err := OpenAuth(KindEngineInbox, skR, nil, AAD{}, sealed); err != ErrAuthMode {
		t.Errorf("nil sender on open: %v", err)
	}
	foreign, _ := must2Foreign(t)
	if _, err := Seal(KindDelta, foreign, goodAAD(), []byte("x")); err != ErrBadKey {
		t.Errorf("foreign key: %v", err)
	}
}

func must2Foreign(t *testing.T) (kem.PublicKey, kem.PrivateKey) {
	t.Helper()
	pub, priv, err := hpke.KEM_P256_HKDF_SHA256.Scheme().GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

func FuzzOpen(f *testing.F) {
	sk, pk, _ := GenerateKEMKey(rand.Reader)
	f.Add(must(Seal(KindDelta, pk, goodAAD(), []byte("x"))))
	f.Add([]byte("IT1"))
	f.Fuzz(func(t *testing.T, blob []byte) {
		if pt, err := Open(KindDelta, sk, goodAAD(), blob); err == nil && string(pt) != "x" {
			t.Fatalf("opened a forged blob: %q", pt)
		}
	})
}

func FuzzUnpad(f *testing.F) {
	f.Add(Pad([]byte("abc")))
	f.Add([]byte{0x80})
	f.Fuzz(func(t *testing.T, b []byte) {
		if out, err := Unpad(b); err == nil && len(Pad(out)) != len(b) {
			t.Fatalf("unpad accepted non-canonical length %d", len(b))
		}
	})
}
