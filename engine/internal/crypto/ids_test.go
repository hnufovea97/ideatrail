package crypto

import (
	"crypto/rand"
	"strings"
	"testing"
	"time"
)

func TestEncodeBase32Known(t *testing.T) {
	ff := make([]byte, 16)
	for i := range ff {
		ff[i] = 0xff
	}
	if got := EncodeBase32(ff); got != strings.Repeat("z", 25)+"w" {
		t.Fatalf("got %s", got)
	}
	if got := EncodeBase32(make([]byte, 16)); got != strings.Repeat("0", 26) {
		t.Fatalf("got %s", got)
	}
}

func TestNewIDUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 10000; i++ {
		id, err := NewID(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		if len(id) != 26 || strings.ContainsAny(id, "|\x1f\nilou") || seen[id] {
			t.Fatalf("bad id %q", id)
		}
		seen[id] = true
	}
}

func TestFormatTime(t *testing.T) {
	ts := time.Date(2026, 11, 14, 14, 12, 3, 999, time.FixedZone("KST", 9*3600))
	if got := FormatTime(ts); got != "2026-11-14T05:12:03Z" {
		t.Fatalf("got %s", got)
	}
}
