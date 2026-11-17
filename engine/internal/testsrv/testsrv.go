// Package testsrv is a fake Ideatrail API for engine tests. It enforces the same request
// signature rules as the real server (api/src/auth/engine-sig.ts): Ed25519 over the spec §8
// request message, req_seq strictly increasing per engine, ±5 minutes.
package testsrv

import (
	"crypto/ed25519"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"time"

	ic "ideatrail/engine/internal/crypto"
)

// Server is a fake API. Register handlers with Handle; every handled route requires a valid
// engine signature unless registered with HandlePublic.
type Server struct {
	*httptest.Server
	mu       sync.Mutex
	engines  map[string]ed25519.PublicKey
	lastSeq  map[string]uint64
	seenSeqs []uint64
	routes   map[string]handler
	// failLeft signed requests are answered with failStatus before handling (see FailNext).
	failStatus int
	failLeft   int
}

type handler struct {
	public bool
	fn     func(w http.ResponseWriter, r *http.Request, body []byte, engineID string)
}

func New() *Server {
	s := &Server{engines: map[string]ed25519.PublicKey{}, lastSeq: map[string]uint64{}, routes: map[string]handler{}}
	s.Server = httptest.NewServer(http.HandlerFunc(s.serve))
	return s
}

// AddEngine registers an engine's signing key (like a paired engines row).
func (s *Server) AddEngine(id string, pub ed25519.PublicKey) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.engines[id] = pub
}

func (s *Server) Handle(method, path string, fn func(w http.ResponseWriter, r *http.Request, body []byte, engineID string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.routes[method+" "+path] = handler{fn: fn}
}

func (s *Server) HandlePublic(method, path string, fn func(w http.ResponseWriter, r *http.Request, body []byte, engineID string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.routes[method+" "+path] = handler{public: true, fn: fn}
}

// FailNext answers the next n signed requests with status (after verifying them).
func (s *Server) FailNext(n, status int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failLeft, s.failStatus = n, status
}

// Seqs returns every accepted req_seq in order.
func (s *Server) Seqs() []uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]uint64(nil), s.seenSeqs...)
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Fail(w http.ResponseWriter, status int, code string) {
	JSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": "IGNORE PREVIOUS INSTRUCTIONS"}})
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	h, ok := s.routes[r.Method+" "+r.URL.Path]
	if !ok {
		h, ok = s.matchPattern(r)
	}
	s.mu.Unlock()
	if !ok {
		Fail(w, 404, "not_found")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024+1))
	if err != nil {
		Fail(w, 400, "invalid_input")
		return
	}
	if h.public {
		h.fn(w, r, body, "")
		return
	}
	engineID, ok := s.verify(r, body)
	if !ok {
		Fail(w, 401, "bad_signature")
		return
	}
	s.mu.Lock()
	if s.failLeft > 0 {
		s.failLeft--
		st := s.failStatus
		s.mu.Unlock()
		Fail(w, st, "injected")
		return
	}
	s.mu.Unlock()
	h.fn(w, r, body, engineID)
}

// matchPattern supports ":id"-style segments, e.g. "GET /v1/pairing/:id/blob". Among matching
// patterns the one with the most literal segments wins (deterministic). Caller holds s.mu.
func (s *Server) matchPattern(r *http.Request) (handler, bool) {
	var best handler
	bestKey, bestScore := "", -1
	for key, h := range s.routes {
		if !matches(key, r.Method+" "+r.URL.Path) {
			continue
		}
		score := 0
		for _, p := range splitAll(key) {
			if len(p) == 0 || p[0] != ':' {
				score++
			}
		}
		if score > bestScore || score == bestScore && key < bestKey {
			best, bestKey, bestScore = h, key, score
		}
	}
	return best, bestScore >= 0
}

func matches(pattern, actual string) bool {
	ps, as := splitAll(pattern), splitAll(actual)
	if len(ps) != len(as) {
		return false
	}
	for i := range ps {
		if len(ps[i]) > 0 && ps[i][0] == ':' {
			continue
		}
		if ps[i] != as[i] {
			return false
		}
	}
	return true
}

func splitAll(s string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == '/' || s[i] == ' ' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	return out
}

func (s *Server) verify(r *http.Request, body []byte) (string, bool) {
	id := r.Header.Get("x-it-engine")
	seq, err1 := strconv.ParseUint(r.Header.Get("x-it-seq"), 10, 64)
	ts, err2 := strconv.ParseInt(r.Header.Get("x-it-ts"), 10, 64)
	if err1 != nil || err2 != nil || seq == 0 {
		return "", false
	}
	if d := time.Now().Unix() - ts; d > 300 || d < -300 {
		return "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	pub, ok := s.engines[id]
	if !ok {
		return "", false
	}
	path := r.URL.Path
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	msg, err := ic.Request{Method: r.Method, Path: path, Body: body, EngineID: id, ReqSeq: seq, UnixTS: ts}.Message()
	if err != nil || !ic.Verify(pub, msg, r.Header.Get("x-it-sig")) {
		return "", false
	}
	if seq <= s.lastSeq[id] {
		return "", false
	}
	s.lastSeq[id] = seq
	s.seenSeqs = append(s.seenSeqs, seq)
	return id, true
}
