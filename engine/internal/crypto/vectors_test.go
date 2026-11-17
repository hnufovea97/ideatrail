package crypto

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestCommittedVectorsUpToDate(t *testing.T) {
	files, err := BuildVectors()
	if err != nil {
		t.Fatal(err)
	}
	for name, want := range files {
		got, err := os.ReadFile(filepath.Join("../../../spec/vectors", name))
		if err != nil {
			t.Fatalf("%s: %v (run: make vectors)", name, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s is stale — run: make vectors", name)
		}
	}
}

func TestXChaChaStandardVector(t *testing.T) {
	// draft-irtf-cfrg-xchacha-03 §A.3.1 ciphertext ‖ tag
	const want = "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52ec0875924c1c7987947deafd8780acf49"
	v, err := xchachaVectors()
	if err != nil {
		t.Fatal(err)
	}
	if got := v.(map[string]any)["standard"].(map[string]string)["ciphertext_and_tag_hex"]; got != want {
		t.Fatalf("got %s", got)
	}
}
