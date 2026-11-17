package pairing

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ideatrail/engine/internal/api"
	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/testsrv"
)

const sessionID = "01jcm3v8q7s2kx4f9d6b5n0tqw"
const userID = "01jcm3v8q7s2kx4f9d6b5n0tqx"

type world struct {
	d      Deps
	srv    *testsrv.Server
	mu     sync.Mutex
	link   string
	blob   map[string]string
	akPriv []byte
	akPub  []byte
}

func newWorld(t *testing.T) *world {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "engine")
	_ = os.Mkdir(dir, 0o700)
	k, _ := keys.LoadOrCreate(dir)
	w := &world{srv: testsrv.New()}
	t.Cleanup(w.srv.Close)
	w.srv.AddEngine(k.EngineID, k.SignPub())
	w.srv.Handle("POST", "/v1/pairing", func(rw http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		testsrv.JSON(rw, 201, map[string]string{"session_id": sessionID})
	})
	w.srv.Handle("GET", "/v1/pairing/:id/blob", func(rw http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		w.mu.Lock()
		defer w.mu.Unlock()
		if w.blob == nil {
			testsrv.Fail(rw, 404, "not_ready")
			return
		}
		testsrv.JSON(rw, 200, w.blob)
	})
	c, _ := api.New(w.srv.URL, k, dir)
	w.d = Deps{API: c, Keys: k, StateDir: dir, AppBase: "https://app.example", Open: func(l string) error { w.link = l; return nil }}
	sk, pk, _ := ic.GenerateKEMKey(rand.Reader)
	w.akPriv, _ = sk.MarshalBinary()
	w.akPub, _ = pk.MarshalBinary()
	return w
}

// deliver plays the browser: seal {user_id, account_pubkey} to EK (kind 8) + HMAC with psk from the link.
func (w *world) deliver(t *testing.T, tamper func(payload, mac []byte)) {
	t.Helper()
	frag := w.link[strings.Index(w.link, "#")+1:]
	parts := strings.Split(frag, ".")
	psk, _ := ic.UnB64(parts[3])
	pt, _ := json.Marshal(map[string]string{"user_id": userID, "account_pubkey": ic.B64(w.akPub)})
	payload, err := ic.Seal(ic.KindPairingPayload, w.d.Keys.KEMPub, ic.AAD{UserID: userID}, pt)
	if err != nil {
		t.Fatal(err)
	}
	m := hmac.New(sha256.New, psk)
	m.Write([]byte(macLabel))
	m.Write([]byte(sessionID))
	m.Write(payload)
	mac := m.Sum(nil)
	if tamper != nil {
		tamper(payload, mac)
	}
	w.mu.Lock()
	w.blob = map[string]string{"user_id": userID, "payload": ic.B64(payload), "mac": hex.EncodeToString(mac)}
	w.mu.Unlock()
}

func TestPairingPinsAccount(t *testing.T) {
	w := newWorld(t)
	s, err := Start(context.Background(), w.d, "Steven의 MacBook")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(w.link)
	if u.Query().Get("s") != sessionID || strings.Contains(u.RawQuery, ".") {
		t.Fatalf("query must carry only the session id: %s", u.RawQuery)
	}
	if !strings.HasPrefix(u.Fragment, "v1.") || len(strings.Split(u.Fragment, ".")) != 5 {
		t.Fatalf("fragment %q", u.Fragment)
	}
	go func() { time.Sleep(30 * time.Millisecond); w.deliver(t, nil) }()
	if err := Wait(context.Background(), w.d, s, 10*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	st, _ := state.Read(w.d.StateDir)
	if st.UserID != userID || st.AccountPub != ic.B64(w.akPub) {
		t.Fatalf("%+v", st)
	}
	if _, err := Start(context.Background(), w.d, "x"); !errors.Is(err, ErrAlreadyPaired) {
		t.Fatalf("second pairing: %v", err)
	}
}

func TestTamperedMACRejected(t *testing.T) {
	w := newWorld(t)
	s, _ := Start(context.Background(), w.d, "pc")
	w.deliver(t, func(_, mac []byte) { mac[0] ^= 1 })
	if err := Wait(context.Background(), w.d, s, time.Millisecond); !errors.Is(err, ErrBadHandoff) {
		t.Fatalf("got %v", err)
	}
	st, _ := state.Read(w.d.StateDir)
	if st.AccountPub != "" {
		t.Fatal("pinned despite bad mac")
	}
}

func TestPinnedKeyCannotChange(t *testing.T) {
	w := newWorld(t)
	_ = state.With(w.d.StateDir, func(s *state.State) error { s.AccountPub = "something-else"; return nil })
	s := &Session{id: sessionID, psk: make([]byte, 32)}
	w.link = "https://app.example/start?s=" + sessionID + "#v1.a.b." + ic.B64(s.psk) + ".pc"
	w.deliver(t, nil)
	if err := Wait(context.Background(), w.d, s, time.Millisecond); !errors.Is(err, ErrAccountChanged) {
		t.Fatalf("got %v", err)
	}
}

func TestSessionHidesSecrets(t *testing.T) {
	w := newWorld(t)
	s, _ := Start(context.Background(), w.d, "pc")
	b, _ := json.Marshal(s)
	if string(b) != "{}" {
		t.Fatalf("session serializes secrets: %s", b)
	}
}
