// Command release-sign is the offline release signing tool: it makes the release key, signs the
// built artifacts and checks the result the same way the engine does at start (selfcheck).
// It never prints the private key; every error is one short fixed sentence.
package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"ideatrail/engine/internal/selfcheck"
)

const (
	msgUsage     = "사용법: release-sign keygen -out <파일> | sign -key <파일> -version <버전> <파일>=<os>/<arch>... | verify -pub <공개키> -version <버전> <파일>=<os>/<arch>..."
	msgKeyExists = "release-sign: 이미 있는 파일이라 열쇠를 만들지 않았어요."
	msgKeyFailed = "release-sign: 열쇠를 만들지 못했어요."
	msgKeyBad    = "release-sign: 열쇠 파일을 읽지 못했어요."
	msgSignFail  = "release-sign: 서명하지 못했어요."
	msgBadTarget = "release-sign: 대상은 <파일>=<os>/<arch> 모양이어야 해요."
	msgVerifyBad = "release-sign: 서명이 맞지 않아요."
	msgOK        = "release-sign: 모두 맞아요."
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

type target struct{ path, goos, goarch string }

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		return fail(stderr, msgUsage)
	}
	switch args[0] {
	case "keygen":
		return keygen(args[1:], stdout, stderr)
	case "sign":
		return sign(args[1:], stderr)
	case "verify":
		return verify(args[1:], stdout, stderr)
	}
	return fail(stderr, msgUsage)
}

func fail(w io.Writer, msg string) int {
	fmt.Fprintln(w, msg)
	return 1
}

func newFlags() *flag.FlagSet {
	fs := flag.NewFlagSet("release-sign", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	return fs
}

func keygen(args []string, stdout, stderr io.Writer) int {
	fs := newFlags()
	out := fs.String("out", "", "")
	if fs.Parse(args) != nil || *out == "" || fs.NArg() != 0 {
		return fail(stderr, msgUsage)
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return fail(stderr, msgKeyFailed)
	}
	f, err := os.OpenFile(*out, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		return fail(stderr, msgKeyExists)
	}
	if err != nil {
		return fail(stderr, msgKeyFailed)
	}
	_, werr := f.WriteString(base64.RawURLEncoding.EncodeToString(priv.Seed()) + "\n")
	if cerr := f.Close(); werr != nil || cerr != nil {
		_ = os.Remove(*out)
		return fail(stderr, msgKeyFailed)
	}
	fmt.Fprintln(stdout, base64.RawURLEncoding.EncodeToString(pub))
	return 0
}

func sign(args []string, stderr io.Writer) int {
	fs := newFlags()
	keyFile := fs.String("key", "", "")
	version := fs.String("version", "", "")
	if fs.Parse(args) != nil || *keyFile == "" || *version == "" || fs.NArg() == 0 {
		return fail(stderr, msgUsage)
	}
	targets, ok := parseTargets(fs.Args())
	if !ok {
		return fail(stderr, msgBadTarget)
	}
	priv, err := readKey(*keyFile)
	if err != nil {
		return fail(stderr, msgKeyBad)
	}
	for _, t := range targets {
		if signOne(priv, t, *version) != nil {
			return fail(stderr, msgSignFail)
		}
	}
	return 0
}

// signOne signs the file's bytes and writes the .sig next to the real file (symlinks resolved,
// the same place selfcheck.Verify reads it).
func signOne(priv ed25519.PrivateKey, t target, version string) error {
	real, err := filepath.EvalSymlinks(t.path)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(real)
	if err != nil {
		return err
	}
	sig := selfcheck.Sign(priv, t.goos, t.goarch, version, sha256.Sum256(data))
	return os.WriteFile(real+".sig", []byte(sig+"\n"), 0o644)
}

func verify(args []string, stdout, stderr io.Writer) int {
	fs := newFlags()
	pub := fs.String("pub", "", "")
	version := fs.String("version", "", "")
	if fs.Parse(args) != nil || *pub == "" || *version == "" || fs.NArg() == 0 {
		return fail(stderr, msgUsage)
	}
	targets, ok := parseTargets(fs.Args())
	if !ok {
		return fail(stderr, msgBadTarget)
	}
	for _, t := range targets {
		if selfcheck.Verify(*pub, t.path, t.goos, t.goarch, *version) != nil {
			return fail(stderr, msgVerifyBad)
		}
	}
	fmt.Fprintln(stdout, msgOK)
	return 0
}

// parseTargets reads <artifact>=<goos>/<goarch> arguments; the split is at the LAST "=" so paths
// may contain one.
func parseTargets(args []string) ([]target, bool) {
	var out []target
	for _, a := range args {
		i := strings.LastIndex(a, "=")
		if i <= 0 {
			return nil, false
		}
		goos, goarch, ok := strings.Cut(a[i+1:], "/")
		if !ok || goos == "" || goarch == "" || strings.Contains(goarch, "/") {
			return nil, false
		}
		out = append(out, target{a[:i], goos, goarch})
	}
	return out, true
}

// readKey accepts the base64url seed keygen writes (or a full 64-byte key).
func readKey(path string) (ed25519.PrivateKey, error) {
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			return nil, err
		}
		if info.Mode().Perm()&0o077 != 0 {
			return nil, errors.New("key file is readable by others")
		}
	}
	text, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(text)))
	if err != nil {
		return nil, err
	}
	switch len(raw) {
	case ed25519.SeedSize:
		return ed25519.NewKeyFromSeed(raw), nil
	case ed25519.PrivateKeySize:
		full := ed25519.PrivateKey(raw)
		if !bytes.Equal(full.Public().(ed25519.PublicKey), ed25519.NewKeyFromSeed(full.Seed()).Public().(ed25519.PublicKey)) {
			return nil, errors.New("key halves do not match")
		}
		return full, nil
	}
	return nil, errors.New("bad key")
}
