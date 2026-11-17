//go:build devbuild

package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/cloudflare/circl/hpke"

	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/record"
	"ideatrail/engine/internal/state"
)

// dev-record records files directly (staging checks only; not in release binaries).
func init() {
	extra["dev-record"] = func(args []string) int {
		if len(args) == 0 {
			fmt.Fprintln(os.Stderr, "dev-record <file>...")
			return 2
		}
		e, err := buildEngine()
		if err != nil {
			fmt.Fprintln(os.Stderr, msgStartFailed)
			return 1
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		r, err := record.Record(ctx, e.Record, record.Input{Paths: args, Milestone: "none"})
		if err != nil {
			fmt.Fprintln(os.Stderr, "record failed:", err)
			return 1
		}
		e.Tick(ctx)
		fmt.Println("recorded", r.Status)
		return 0
	}
}

// dev-seed makes this engine look paired with a throwaway account (staging checks only) and
// prints the rows to insert on the staging server. The account private key is discarded.
func init() {
	extra["dev-seed"] = func(args []string) int {
		if len(args) != 1 {
			fmt.Fprintln(os.Stderr, "dev-seed <folder>")
			return 2
		}
		folder, err := filepath.EvalSymlinks(args[0])
		if err != nil {
			fmt.Fprintln(os.Stderr, "folder:", err)
			return 1
		}
		e, err := buildEngine()
		if err != nil {
			fmt.Fprintln(os.Stderr, msgStartFailed)
			return 1
		}
		accPub, _, err := hpke.KEM_X25519_HKDF_SHA256.Scheme().GenerateKeyPair()
		if err != nil {
			return 1
		}
		accRaw, _ := accPub.MarshalBinary()
		kemRaw, _ := e.Keys.KEMPub.MarshalBinary()
		userID, _ := ic.NewID(rand.Reader)
		rootID, _ := ic.NewID(rand.Reader)
		err = state.With(e.StateDir, func(s *state.State) error {
			s.UserID = userID
			s.AccountPub = base64.RawURLEncoding.EncodeToString(accRaw)
			s.Folders = map[string]string{folder: rootID}
			s.Roots = map[string]state.Root{rootID: {}}
			return nil
		})
		if err != nil {
			return 1
		}
		fmt.Printf("user_id=%s\nengine_id=%s\naccount_pub_hex=%s\nsign_pub_hex=%s\nkem_pub_hex=%s\n",
			userID, e.Keys.EngineID, hex.EncodeToString(accRaw), hex.EncodeToString(e.Keys.SignPub()), hex.EncodeToString(kemRaw))
		return 0
	}
}
