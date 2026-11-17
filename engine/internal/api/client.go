// Package api is the engine's signed client for the Ideatrail server (spec §8). Only the MCP
// process uses it; hooks never call the API (spec §2).
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/state"
)

const (
	MaxRequestBody  = 64 * 1024
	maxResponseBody = 1 << 20
	requestTimeout  = 30 * time.Second
	maxAttempts     = 3
	requestLock     = "request.lock"
	// requestLockWait covers one full Do (3 attempts × 30s + backoff) held by another process.
	requestLockWait = 3 * time.Minute
)

// knownCodes are server error codes the engine understands; anything else becomes "unknown" so
// server-chosen text never reaches state, logs or the AI.
var knownCodes = map[string]bool{
	"bad_signature": true, "invalid_input": true, "id_conflict": true, "account_unconfirmed": true, "engine_paused": true,
	"too_many_pending": true, "too_many_deltas": true, "too_many_approvals": true, "import_allowance_used": true,
	"invalid_receipt": true, "root_not_found": true, "not_found": true, "not_ready": true, "payload_too_large": true,
	"rate_limited": true, "conflict": true, "inbox_full": true, "anchor_not_found": true, "internal": true,
}

var ErrRequestTooLarge = errors.New("request body over 64KB")

// Error is a server refusal. Message() is fixed text keyed by Code — the server's own message
// is never shown to the AI (it could carry injected instructions).
type Error struct {
	Status int
	Code   string
}

func (e *Error) Error() string { return fmt.Sprintf("server %d %s", e.Status, e.Code) }

// Retryable reports whether the same request may succeed later without changes. 401 is included:
// the usual cause is clock skew (±5 min), which fixes itself.
func (e *Error) Retryable() bool {
	return e.Status >= 500 || e.Status == 401 || e.Status == 423 || e.Status == 429
}

// Client signs requests with the engine key and keeps req_seq in the state file.
type Client struct {
	base     *url.URL
	keys     *keys.Keys
	stateDir string
	http     *http.Client
	sleep    func(time.Duration)
}

// New refuses non-https bases except loopback (tests).
func New(base string, k *keys.Keys, stateDir string) (*Client, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return nil, errors.New("api base must be an absolute URL")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && isLoopback(u.Hostname())) {
		return nil, errors.New("api base must be https")
	}
	return &Client{
		base:     u,
		keys:     k,
		stateDir: stateDir,
		http: &http.Client{
			Timeout:       requestTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		sleep: time.Sleep,
	}, nil
}

func (c *Client) wait(ctx context.Context, d time.Duration) error {
	if c.sleep != nil && ctx.Done() == nil {
		c.sleep(d)
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func isLoopback(h string) bool { return h == "127.0.0.1" || h == "localhost" || h == "::1" }

// Do sends one signed request. One request per engine at a time: request.lock is held from taking
// req_seq until the answer (spec §2). Each attempt persists a NEW req_seq before sending, so a
// lost response never leaves the engine reusing a number the server already saw.
func (c *Client) Do(ctx context.Context, method, path string, body, out any) error {
	var raw []byte
	if body != nil {
		var err error
		if raw, err = json.Marshal(body); err != nil {
			return err
		}
	}
	if len(raw) > MaxRequestBody {
		return ErrRequestTooLarge
	}
	unlock, err := state.LockFile(c.stateDir, requestLock, requestLockWait)
	if err != nil {
		return fmt.Errorf("request lock: %w", err)
	}
	defer unlock()

	// POST retries are safe: the server dedupes records/deltas/approvals by id and the rest are
	// idempotent; every attempt carries a fresh req_seq.
	var last error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			if err := c.wait(ctx, time.Duration(1<<attempt)*250*time.Millisecond); err != nil {
				return err
			}
		}
		status, resp, err := c.send(ctx, method, path, raw)
		if err != nil {
			last = err
			if ctx.Err() != nil {
				return ctx.Err()
			}
			continue
		}
		if status >= 200 && status < 300 {
			if out != nil && len(resp) > 0 {
				return json.Unmarshal(resp, out)
			}
			return nil
		}
		apiErr := &Error{Status: status, Code: errorCode(resp)}
		if status < 500 {
			return apiErr
		}
		last = apiErr
	}
	return last
}

func (c *Client) send(ctx context.Context, method, path string, raw []byte) (int, []byte, error) {
	var seq uint64
	if err := state.With(c.stateDir, func(s *state.State) error {
		var err error
		seq, err = s.ReqSeq.Next()
		return err
	}); err != nil {
		return 0, nil, err
	}
	ts := time.Now().Unix()
	msg, err := ic.Request{Method: method, Path: path, Body: raw, EngineID: c.keys.EngineID, ReqSeq: seq, UnixTS: ts}.Message()
	if err != nil {
		return 0, nil, err
	}
	sig, err := ic.Sign(c.keys.Sign, msg)
	if err != nil {
		return 0, nil, err
	}
	u := c.base.ResolveReference(&url.URL{Path: pathOnly(path), RawQuery: queryOf(path)})
	req, err := http.NewRequestWithContext(ctx, method, u.String(), bytes.NewReader(raw))
	if err != nil {
		return 0, nil, err
	}
	if raw != nil {
		req.Header.Set("content-type", "application/json")
	}
	req.Header.Set("x-it-engine", c.keys.EngineID)
	req.Header.Set("x-it-seq", strconv.FormatUint(seq, 10))
	req.Header.Set("x-it-ts", strconv.FormatInt(ts, 10))
	req.Header.Set("x-it-sig", sig)
	res, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBody+1))
	if err != nil {
		return 0, nil, err
	}
	if len(body) > maxResponseBody {
		return 0, nil, errors.New("response too large")
	}
	return res.StatusCode, body, nil
}

func errorCode(body []byte) string {
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &e) != nil || !knownCodes[e.Error.Code] {
		return "unknown"
	}
	return e.Error.Code
}

func pathOnly(p string) string { before, _, _ := strings.Cut(p, "?"); return before }

func queryOf(p string) string { _, after, _ := strings.Cut(p, "?"); return after }
