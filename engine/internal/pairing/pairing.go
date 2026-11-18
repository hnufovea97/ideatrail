// Package pairing links this engine to an account (spec §9). The pairing secret (psk) and the
// link live only in this process: the engine opens the browser itself and never returns either
// to the AI — a leaked psk would let a hostile server pin someone else's account key.
package pairing

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"ideatrail/engine/internal/api"
	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/state"
)

var (
	ErrAlreadyPaired  = errors.New("engine is already linked to an account")
	ErrAccountChanged = errors.New("account key differs from the pinned one; recording stopped")
	ErrBadHandoff     = errors.New("pairing handoff failed verification")
	ErrTimeout        = errors.New("pairing timed out")
)

const (
	pairWindow   = 10 * time.Minute
	maxBlobBytes = 64 * 1024
	macLabel     = "ideatrail/v1/pair"
)

// Session is an in-progress pairing. Its fields are unexported on purpose.
type Session struct {
	id   string
	psk  []byte
	link string
}

// ID is safe to show (the server already knows it); the link and psk are not.
func (s *Session) ID() string { return s.id }

// String and GoString keep the psk and link out of any %v / %+v / %#v output.
func (s *Session) String() string   { return "pairing.Session{" + s.id + " [redacted]}" }
func (s *Session) GoString() string { return s.String() }

func isLoopback(h string) bool { return h == "127.0.0.1" || h == "localhost" || h == "::1" }

// Deps lets tests replace the browser opener.
type Deps struct {
	API      *api.Client
	Keys     *keys.Keys
	StateDir string
	AppBase  string // compile-time constant in production
	Open     func(link string) error
}

// Start registers a pairing session and opens the signup page in the user's browser.
func Start(ctx context.Context, d Deps, computerName string) (*Session, error) {
	st, err := state.Read(d.StateDir)
	if err != nil {
		return nil, err
	}
	if st.AccountPub != "" {
		return nil, ErrAlreadyPaired
	}
	app, err := url.Parse(d.AppBase)
	if err != nil || !(app.Scheme == "https" || (app.Scheme == "http" && isLoopback(app.Hostname()))) {
		return nil, errors.New("app base must be https")
	}
	kemPub, err := d.Keys.KEMPub.MarshalBinary()
	if err != nil {
		return nil, err
	}
	var out struct {
		SessionID string `json:"session_id"`
	}
	if err := d.API.Do(ctx, "POST", "/v1/pairing", map[string]string{
		"engine_id": d.Keys.EngineID, "sign_pubkey": ic.B64(d.Keys.SignPub()), "kem_pubkey": ic.B64(kemPub),
	}, &out); err != nil {
		return nil, err
	}
	if !validID(out.SessionID) {
		return nil, ErrBadHandoff
	}
	psk := make([]byte, 32)
	if _, err := rand.Read(psk); err != nil {
		return nil, err
	}
	signFP := sha256.Sum256(d.Keys.SignPub())
	kemFP := sha256.Sum256(kemPub)
	link := strings.TrimRight(d.AppBase, "/") + "/start?s=" + out.SessionID + "#v1." +
		ic.B64(signFP[:]) + "." + ic.B64(kemFP[:]) + "." + ic.B64(psk) + "." + ic.B64([]byte(computerName))
	s := &Session{id: out.SessionID, psk: psk, link: link}
	open := d.Open
	if open == nil {
		open = OpenBrowser
	}
	if err := open(link); err != nil {
		return nil, err
	}
	return s, nil
}

type blob struct {
	UserID  string `json:"user_id"`
	Payload string `json:"payload"`
	MAC     string `json:"mac"`
}

// Wait polls for the browser's handoff, verifies it and pins the account key.
func Wait(ctx context.Context, d Deps, s *Session, every time.Duration) error {
	deadline := time.Now().Add(pairWindow)
	for {
		var b blob
		err := d.API.Do(ctx, "GET", "/v1/pairing/"+s.id+"/blob", nil, &b)
		var apiErr *api.Error
		switch {
		case err == nil:
			return accept(d, s, b)
		case errors.As(err, &apiErr) && (apiErr.Status == 404 || apiErr.Retryable()):
			// not delivered yet, or a passing server/network problem: keep polling until the deadline
		default:
			return err
		}
		if time.Now().After(deadline) {
			return ErrTimeout
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(every):
		}
	}
}

func accept(d Deps, s *Session, b blob) error {
	payload, err := ic.UnB64(b.Payload)
	if err != nil || len(payload) > maxBlobBytes || !validID(b.UserID) {
		return ErrBadHandoff
	}
	got, err := hex.DecodeString(b.MAC)
	if err != nil {
		return ErrBadHandoff
	}
	mac := hmac.New(sha256.New, s.psk)
	mac.Write([]byte(macLabel))
	mac.Write([]byte(s.id))
	mac.Write(payload)
	if !hmac.Equal(mac.Sum(nil), got) {
		return ErrBadHandoff
	}
	pt, err := ic.Open(ic.KindPairingPayload, d.Keys.KEMPriv, ic.AAD{UserID: b.UserID}, payload)
	if err != nil {
		return ErrBadHandoff
	}
	var p struct {
		UserID        string `json:"user_id"`
		AccountPubkey string `json:"account_pubkey"`
	}
	if json.Unmarshal(pt, &p) != nil || p.UserID != b.UserID {
		return ErrBadHandoff
	}
	ak, err := ic.UnB64(p.AccountPubkey)
	if err != nil || len(ak) != 32 {
		return ErrBadHandoff
	}
	if _, err := ic.ParseKEMPublic(ak); err != nil {
		return ErrBadHandoff
	}
	return state.With(d.StateDir, func(st *state.State) error {
		if (st.AccountPub != "" && st.AccountPub != p.AccountPubkey) || (st.UserID != "" && st.UserID != p.UserID) {
			return ErrAccountChanged
		}
		st.UserID, st.AccountPub = p.UserID, p.AccountPubkey
		return nil
	})
}

func validID(s string) bool {
	if len(s) != 26 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if strings.IndexByte("0123456789abcdefghjkmnpqrstvwxyz", s[i]) < 0 {
			return false
		}
	}
	return true
}

// OpenBrowser opens an https link without a shell (argv only).
func OpenBrowser(link string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("/usr/bin/open", link).Run()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", link).Run()
	default:
		return exec.Command("xdg-open", link).Run()
	}
}
