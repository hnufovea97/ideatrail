package crypto

import (
	"encoding/json"
	"os"
	"testing"
)

// TestBrowserSealsOpenInGo opens blobs sealed by the TS implementation (kinds 7, 8, 9).
func TestBrowserSealsOpenInGo(t *testing.T) {
	var f struct {
		RecipientPriv string `json:"recipient_priv_hex"`
		SenderPub     string `json:"sender_pub_hex"`
		Vectors       []struct {
			Kind         int    `json:"kind"`
			UserID       string `json:"user_id"`
			RootID       string `json:"root_id"`
			RecordID     string `json:"record_id"`
			PlaintextHex string `json:"plaintext_hex"`
			SealedHex    string `json:"sealed_hex"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(must(os.ReadFile("../../../spec/vectors/hpke_browser.json")), &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Vectors) != 3 {
		t.Fatalf("want 3 browser seals, got %d", len(f.Vectors))
	}
	skR := must(ParseKEMPrivate(unhex(t, f.RecipientPriv)))
	pkS := must(ParseKEMPublic(unhex(t, f.SenderPub)))
	for _, v := range f.Vectors {
		a := AAD{UserID: v.UserID, RootID: v.RootID, RecordID: v.RecordID}
		blob := unhex(t, v.SealedHex)
		var pt []byte
		var err error
		if Kind(v.Kind) == KindEngineInbox {
			pt, err = OpenAuth(Kind(v.Kind), skR, pkS, a, blob)
		} else {
			pt, err = Open(Kind(v.Kind), skR, a, blob)
		}
		if err != nil || string(pt) != string(unhex(t, v.PlaintextHex)) {
			t.Fatalf("kind %d: %v", v.Kind, err)
		}
	}
}
