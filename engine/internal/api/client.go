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
)

var ErrRequestTooLarge = errors.New("request body over 64KB")

// Error is a server refusal. Message() is fixed text keyed by Code — the server's own message
// is never shown to the AI (it could carry injected instructions).
type Error struct {
	Status int
	Code   string
}

func (e *Error) Error() string { return fmt.Sprintf("server %d %s", e.Status, e.Code) }

// Retryable reports whether the same request may succeed later without changes.
func (e *Error) Retryable() bool { return e.Status >= 500 || e.Status == 423 || e.Status == 429 }

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
	unlock, err := state.LockFile(c.stateDir, requestLock)
	if err != nil {
		return err
	}
	defer unlock()

	var last error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			c.sleep(time.Duration(1<<attempt) * 250 * time.Millisecond)
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
	if json.Unmarshal(body, &e) != nil || len(e.Error.Code) > 64 {
		return "unknown"
	}
	return e.Error.Code
}

func pathOnly(p string) string {
	if i := bytes.IndexByte([]byte(p), '?'); i >= 0 {
		return p[:i]
	}
	return p
}

func queryOf(p string) string {
	if i := bytes.IndexByte([]byte(p), '?'); i >= 0 {
		return p[i+1:]
	}
	return ""
}
