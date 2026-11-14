package commit

import (
	"encoding/hex"
	"encoding/json"
	"errors"
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

var wantErr = map[string]error{
	"duplicate_path": ErrDuplicatePath,
	"invalid_path":   ErrInvalidPath,
}

func TestManifestVectors(t *testing.T) {
	for _, v := range loadVectors(t) {
		if v.ManifestEntries == nil {
			continue
		}
		var es []Entry
		for _, e := range v.ManifestEntries {
			es = append(es, Entry{Path: e.Path, Content: mustHex(t, e.ContentHex)})
		}
		m, err := Manifest(es)
		if v.ExpectError != "" {
			if !errors.Is(err, wantErr[v.ExpectError]) {
				t.Errorf("%s: want %s, got %v", v.Name, v.ExpectError, err)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%s: %v", v.Name, err)
		}
		if hex.EncodeToString(m) != v.ManifestHex {
			t.Fatalf("%s: manifest mismatch\n got %x", v.Name, m)
		}
		got := Commit(mustHex(t, v.NonceHex), m)
		if hex.EncodeToString(got[:]) != v.CommitmentHex {
			t.Errorf("%s: got %x want %s", v.Name, got, v.CommitmentHex)
		}
	}
}
