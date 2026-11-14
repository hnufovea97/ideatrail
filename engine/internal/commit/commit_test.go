package commit

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

type vector struct {
	Name            string `json:"name"`
	NonceHex        string `json:"nonce_hex"`
	ContentHex      string `json:"content_hex"`
	ManifestEntries []struct {
		Path       string `json:"path"`
		ContentHex string `json:"content_hex"`
	} `json:"manifest_entries"`
	ManifestHex   string `json:"manifest_hex"`
	CommitmentHex string `json:"commitment_hex"`
	ExpectError   string `json:"expect_error"`
}

func loadVectors(t *testing.T) []vector {
	t.Helper()
	b, err := os.ReadFile("../../../spec/vectors/commitment.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct{ Vectors []vector }
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f.Vectors
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestCommitVectors(t *testing.T) {
	for _, v := range loadVectors(t) {
		if v.ManifestEntries != nil {
			continue
		}
		got := Commit(mustHex(t, v.NonceHex), mustHex(t, v.ContentHex))
		if hex.EncodeToString(got[:]) != v.CommitmentHex {
			t.Errorf("%s: got %x want %s", v.Name, got, v.CommitmentHex)
		}
	}
}
