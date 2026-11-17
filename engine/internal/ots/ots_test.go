package ots

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

type fixture struct {
	DigestHex      string `json:"digest_hex"`
	PendingAlice   string `json:"pending_alice_hex"`
	PendingBob     string `json:"pending_bob_hex"`
	DirectAliceOTS string `json:"direct_alice_ots_hex"`
	BlockHeight    uint64 `json:"block_height"`
}

func load(t *testing.T) (fixture, []byte) {
	t.Helper()
	raw, err := os.ReadFile("../../../spec/vectors/ots/receipts.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	_ = json.Unmarshal(raw, &f)
	d, _ := hex.DecodeString(f.DigestHex)
	return f, d
}

func unhex(s string) []byte { b, _ := hex.DecodeString(s); return b }

func TestRealM0Receipts(t *testing.T) {
	f, digest := load(t)
	for _, h := range []string{f.PendingAlice, f.PendingBob} {
		if err := CheckPending(unhex(h), digest); err != nil {
			t.Fatal(err)
		}
	}
	// Complete .ots file (header 31 bytes + version + sha256 op + digest) → bitcoin 975755.
	ots := unhex(f.DirectAliceOTS)
	tree, err := Parse(ots[31+1+1+32:], digest)
	if err != nil {
		t.Fatal(err)
	}
	if tree.BitcoinHeight() != f.BlockHeight {
		t.Fatalf("height %d", tree.BitcoinHeight())
	}
	if err := CheckPending(ots[31+1+1+32:], digest); !errors.Is(err, ErrBad) {
		t.Fatal("a receipt that already claims a block must not pass as pending")
	}
}

func TestParserLimits(t *testing.T) {
	_, digest := load(t)
	for name, b := range map[string][]byte{
		"unknown op": {0x02},
		"deep":       []byte(strings.Repeat("\x08", 300)),
		"truncated":  {0xf0, 0x05, 0x01},
		"bad utf8":   {0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e, 0x02, 0x01, 0xff},
	} {
		if _, err := Parse(b, digest); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestAllowedHost(t *testing.T) {
	for _, bad := range []string{"http://a.pool.opentimestamps.org", "https://evil.example", "https://u:p@a.pool.opentimestamps.org", "https://a.pool.opentimestamps.org:8443"} {
		if _, ok := AllowedHost(bad); ok {
			t.Errorf("%s allowed", bad)
		}
	}
	if h, ok := AllowedHost("https://alice.btc.calendar.opentimestamps.org/x"); !ok || h != "alice.btc.calendar.opentimestamps.org" {
		t.Fatal("alice refused")
	}
}

func TestSubmitNeedsTwo(t *testing.T) {
	f, digest := load(t)
	isLoopbackTestURL = func(u string) bool { return strings.HasPrefix(u, "http://127.0.0.1") }
	defer func() { isLoopbackTestURL = func(string) bool { return false } }()
	good := func(h string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "POST" || r.URL.Path != "/digest" {
				w.WriteHeader(404)
				return
			}
			_, _ = w.Write(unhex(h))
		}))
	}
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }))
	big := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(make([]byte, 5000)) }))
	a, b := good(f.PendingAlice), good(f.PendingBob)
	for _, s := range []*httptest.Server{a, b, bad, big} {
		defer s.Close()
	}
	var d [32]byte
	copy(d[:], digest)
	got, err := Submit(context.Background(), nil, []string{a.URL, b.URL, bad.URL}, d)
	if err != nil || len(got) != 2 {
		t.Fatalf("%v %d", err, len(got))
	}
	if _, err := Submit(context.Background(), nil, []string{a.URL, bad.URL, big.URL}, d); !errors.Is(err, ErrTooFewReceipts) {
		t.Fatalf("got %v", err)
	}
}
