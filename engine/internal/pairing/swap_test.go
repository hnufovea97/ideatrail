package pairing

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"testing"
	"time"

	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/state"
)

// M4 4.8: the server knows every public value but not psk. If it swaps in its own account key,
// the handoff MAC cannot match and the engine pins nothing.
func TestServerSwappedAccountKeyRefused(t *testing.T) {
	w := newWorld(t)
	s, err := Start(context.Background(), w.d, "Steven-Air")
	if err != nil {
		t.Fatal(err)
	}
	_, attackerPub, _ := ic.GenerateKEMKey(rand.Reader)
	raw, _ := attackerPub.MarshalBinary()
	pt, _ := json.Marshal(map[string]string{"user_id": userID, "account_pubkey": ic.B64(raw)})
	payload, err := ic.Seal(ic.KindPairingPayload, w.d.Keys.KEMPub, ic.AAD{UserID: userID}, pt)
	if err != nil {
		t.Fatal(err)
	}
	guess := make([]byte, 32)
	_, _ = rand.Read(guess)
	m := hmac.New(sha256.New, guess)
	m.Write([]byte(macLabel))
	m.Write([]byte(sessionID))
	m.Write(payload)
	w.mu.Lock()
	w.blob = map[string]string{"user_id": userID, "payload": ic.B64(payload), "mac": hex.EncodeToString(m.Sum(nil))}
	w.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := Wait(ctx, w.d, s, 10*time.Millisecond); !errors.Is(err, ErrBadHandoff) {
		t.Fatalf("want ErrBadHandoff, got %v", err)
	}
	st, err := state.Read(w.d.StateDir)
	if err != nil {
		t.Fatal(err)
	}
	if st.AccountPub != "" || st.UserID != "" {
		t.Fatalf("pinned an account key the browser never sent: user=%q", st.UserID)
	}
}
