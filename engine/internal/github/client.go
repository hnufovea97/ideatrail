// Package github connects the engine to the user's own GitHub (device flow, private proofs
// repository, one commit per queued record). GitHub responses are untrusted: errors never carry
// response bodies, redirects are not followed, sizes are capped.
package github

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

const (
	maxBody   = 1 << 20
	timeout   = 30 * time.Second
	userAgent = "ideatrail-engine"
)

// Error is a GitHub refusal: status only (no body — it could carry anything).
type Error struct{ Status int }

func (e *Error) Error() string { return "github " + strconv.Itoa(e.Status) }

// RateLimited asks the caller to wait before retrying.
type RateLimited struct{ Wait time.Duration }

func (e *RateLimited) Error() string { return "github rate limited" }

// Client calls the GitHub REST API with one token.
type Client struct {
	Base  string // https://api.github.com (tests: httptest URL)
	token string
	http  *http.Client
}

func NewClient(base, token string) *Client {
	return &Client{Base: base, token: token, http: noRedirect()}
}

func noRedirect() *http.Client {
	return &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Base+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", userAgent)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		if inner := errors.Unwrap(err); inner != nil { // drop the URL wrapper, keep the cause
			err = inner
		}
		return fmt.Errorf("github request: %w", err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, maxBody+1))
	if err != nil || len(b) > maxBody {
		return &Error{Status: 0}
	}
	if (res.StatusCode == 403 || res.StatusCode == 429) && rateLimited(res) {
		return &RateLimited{Wait: waitFor(res)}
	}
	if res.StatusCode >= 300 {
		return &Error{Status: res.StatusCode}
	}
	if out != nil && len(b) > 0 {
		return json.Unmarshal(b, out)
	}
	return nil
}

func rateLimited(res *http.Response) bool {
	return res.Header.Get("Retry-After") != "" || res.Header.Get("X-RateLimit-Remaining") == "0"
}

func waitFor(res *http.Response) time.Duration {
	if s, err := strconv.Atoi(res.Header.Get("Retry-After")); err == nil {
		return time.Duration(s) * time.Second
	}
	if reset, err := strconv.ParseInt(res.Header.Get("X-RateLimit-Reset"), 10, 64); err == nil {
		if d := time.Until(time.Unix(reset, 0)); d > 0 {
			return d
		}
	}
	return time.Minute
}
