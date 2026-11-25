package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func call(args ...string) (int, string, string) {
	var out, errb bytes.Buffer
	code := run(args, &out, &errb)
	return code, out.String(), errb.String()
}

// fixture makes a key and an artifact, and returns the public key, key file and artifact path.
func fixture(t *testing.T) (pub, keyFile, art string) {
	t.Helper()
	dir := t.TempDir()
	keyFile = filepath.Join(dir, "release.key")
	code, out, errs := call("keygen", "-out", keyFile)
	if code != 0 {
		t.Fatalf("keygen: %d %q", code, errs)
	}
	art = filepath.Join(dir, "ideatrail-darwin")
	if err := os.WriteFile(art, []byte("binary-bytes"), 0o700); err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(out), keyFile, art
}

func TestKeygenSignVerifyRoundtrip(t *testing.T) {
	pub, key, art := fixture(t)
	target := art + "=darwin/universal"
	if code, _, e := call("sign", "-key", key, "-version", "0.1.0", target); code != 0 {
		t.Fatalf("sign: %d %q", code, e)
	}
	if _, err := os.Stat(art + ".sig"); err != nil {
		t.Fatal("no .sig next to the artifact")
	}
	if code, _, e := call("verify", "-pub", pub, "-version", "0.1.0", target); code != 0 {
		t.Fatalf("verify: %d %q", code, e)
	}
}

func TestTamperedFileAndWrongVersionAndWrongTargetFail(t *testing.T) {
	pub, key, art := fixture(t)
	target := art + "=darwin/universal"
	_, _, _ = call("sign", "-key", key, "-version", "0.1.0", target)
	if code, _, _ := call("verify", "-pub", pub, "-version", "0.1.1", target); code == 0 {
		t.Fatal("wrong version verified")
	}
	if code, _, _ := call("verify", "-pub", pub, "-version", "0.1.0", art+"=windows/amd64"); code == 0 {
		t.Fatal("wrong platform verified")
	}
	_ = os.WriteFile(art, []byte("binary-bytez"), 0o700)
	if code, _, _ := call("verify", "-pub", pub, "-version", "0.1.0", target); code == 0 {
		t.Fatal("tampered file verified")
	}
}

func TestVerifyWithAnotherKeyFailsAndEmptyKeyIsRefused(t *testing.T) {
	_, key, art := fixture(t)
	target := art + "=darwin/universal"
	_, _, _ = call("sign", "-key", key, "-version", "0.1.0", target)
	other, _, _ := fixture(t)
	if code, _, _ := call("verify", "-pub", other, "-version", "0.1.0", target); code == 0 {
		t.Fatal("another key verified")
	}
	if code, _, _ := call("verify", "-pub", "", "-version", "0.1.0", target); code == 0 {
		t.Fatal("empty key must not skip the check")
	}
}

func TestKeygenRefusesExistingFileAndLeavesItAlone(t *testing.T) {
	_, key, _ := fixture(t)
	before, _ := os.ReadFile(key)
	code, out, _ := call("keygen", "-out", key)
	after, _ := os.ReadFile(key)
	if code == 0 || out != "" || !bytes.Equal(before, after) {
		t.Fatalf("code=%d out=%q", code, out)
	}
}

func TestPrivateKeyNeverOnOutput(t *testing.T) {
	dir := t.TempDir()
	key := filepath.Join(dir, "k")
	var out, errb bytes.Buffer
	if run([]string{"keygen", "-out", key}, &out, &errb) != 0 {
		t.Fatal("keygen failed")
	}
	secret, _ := os.ReadFile(key)
	text := strings.TrimSpace(string(secret))
	art := filepath.Join(dir, "a")
	_ = os.WriteFile(art, []byte("x"), 0o600)
	run([]string{"sign", "-key", key, "-version", "0.1.0", art + "=linux/amd64"}, &out, &errb)
	run([]string{"sign", "-key", filepath.Join(dir, "missing"), "-version", "0.1.0", art + "=linux/amd64"}, &out, &errb)
	run([]string{"verify", "-pub", text, "-version", "0.1.0", art + "=linux/amd64"}, &out, &errb)
	if strings.Contains(out.String()+errb.String(), text) || len(text) == 0 {
		t.Fatal("private key reached the output")
	}
	if strings.Count(strings.TrimSpace(out.String()), "\n") != 0 {
		t.Fatalf("keygen/sign printed more than the public key: %q", out.String())
	}
	if fi, _ := os.Stat(key); runtimeUnix() && fi.Mode().Perm() != 0o600 {
		t.Fatalf("key file mode %v", fi.Mode().Perm())
	}
}

func TestUsageErrorsAreFixedAndShort(t *testing.T) {
	for _, args := range [][]string{{}, {"nope"}, {"sign"}, {"sign", "-key", "k", "-version", "1"}, {"verify", "-pub", "x", "-version", "1", "bad-target"}} {
		code, _, e := call(args...)
		if code == 0 || len(e) == 0 || strings.Count(e, "\n") > 1 {
			t.Fatalf("%v: %d %q", args, code, e)
		}
	}
}

func runtimeUnix() bool { return runtime.GOOS != "windows" }

func TestSignRefusesAKeyFileOthersCanRead(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("file modes do not apply")
	}
	_, key, art := fixture(t)
	if err := os.Chmod(key, 0o644); err != nil {
		t.Fatal(err)
	}
	code, _, e := call("sign", "-key", key, "-version", "0.1.0", art+"=darwin/universal")
	if code == 0 || strings.TrimSpace(e) != msgKeyBad {
		t.Fatalf("%d %q", code, e)
	}
	if _, err := os.Stat(art + ".sig"); err == nil {
		t.Fatal("signed with a readable key")
	}
}

func TestSignRefusesAFullKeyWhosePublicHalfDoesNotMatchTheSeed(t *testing.T) {
	_, key, art := fixture(t)
	raw, _ := os.ReadFile(key)
	seed, _ := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(raw)))
	full := append([]byte(nil), ed25519.NewKeyFromSeed(seed)...)
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	copy(full[32:], other[32:]) // a public half that is not this seed's
	bad := filepath.Join(t.TempDir(), "bad.key")
	if err := os.WriteFile(bad, []byte(base64.RawURLEncoding.EncodeToString(full)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	code, _, e := call("sign", "-key", bad, "-version", "0.1.0", art+"=darwin/universal")
	if code == 0 || strings.TrimSpace(e) != msgKeyBad {
		t.Fatalf("%d %q", code, e)
	}
	good := filepath.Join(t.TempDir(), "good.key")
	if err := os.WriteFile(good, []byte(base64.RawURLEncoding.EncodeToString(ed25519.NewKeyFromSeed(seed))+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if code, _, e := call("sign", "-key", good, "-version", "0.1.0", art+"=darwin/universal"); code != 0 {
		t.Fatalf("a consistent full key was refused: %q", e)
	}
}
