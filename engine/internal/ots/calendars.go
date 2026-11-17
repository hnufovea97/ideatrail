package ots

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// SubmitCalendars are where the engine sends digests (aggregators; receipts point to alice/bob/finney).
var SubmitCalendars = []string{
	"https://a.pool.opentimestamps.org",
	"https://b.pool.opentimestamps.org",
	"https://a.pool.eternitywall.com",
}

// AllowedHosts must match the server's allowlist (api/src/ots/calendars.ts).
var AllowedHosts = map[string]bool{
	"a.pool.opentimestamps.org": true, "b.pool.opentimestamps.org": true,
	"alice.btc.calendar.opentimestamps.org": true, "bob.btc.calendar.opentimestamps.org": true,
	"finney.calendar.eternitywall.com": true, "a.pool.eternitywall.com": true, "ots.btc.catallaxy.com": true,
}

const (
	MinReceipts     = 2
	responseCap     = 4096
	calendarTimeout = 10 * time.Second
)

var ErrTooFewReceipts = errors.New("fewer than 2 calendars answered")

// AllowedHost returns the host of an https calendar URL with no credentials or port, if allowed.
func AllowedHost(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || !AllowedHosts[u.Hostname()] {
		return "", false
	}
	return u.Hostname(), true
}

// Receipt is a pending timestamp from one calendar.
type Receipt struct {
	Calendar string
	Pending  []byte
}

// CheckPending validates a pending receipt for digest: parses, every pending URI is allowed,
// and it does not already claim a bitcoin block (the server enforces the same).
func CheckPending(b, digest []byte) error {
	t, err := Parse(b, digest)
	if err != nil {
		return err
	}
	uris := t.PendingURIs()
	if len(uris) == 0 || t.BitcoinHeight() != 0 {
		return ErrBad
	}
	for _, u := range uris {
		if _, ok := AllowedHost(u); !ok {
			return ErrBad
		}
	}
	return nil
}

// Submit sends digest to the calendars in parallel and needs at least MinReceipts valid receipts.
func Submit(ctx context.Context, hc *http.Client, calendars []string, digest [32]byte) ([]Receipt, error) {
	if hc == nil {
		hc = &http.Client{Timeout: calendarTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	var mu sync.Mutex
	var out []Receipt
	var wg sync.WaitGroup
	for _, cal := range calendars {
		if _, ok := AllowedHost(cal); !ok && !isLoopbackTestURL(cal) {
			continue
		}
		wg.Add(1)
		go func(cal string) {
			defer wg.Done()
			b, err := post(ctx, hc, cal, digest)
			if err != nil || CheckPending(b, digest[:]) != nil {
				return
			}
			mu.Lock()
			out = append(out, Receipt{Calendar: cal, Pending: b})
			mu.Unlock()
		}(cal)
	}
	wg.Wait()
	if len(out) < MinReceipts {
		return nil, ErrTooFewReceipts
	}
	return out, nil
}

func post(ctx context.Context, hc *http.Client, cal string, digest [32]byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, calendarTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", cal+"/digest", bytes.NewReader(digest[:]))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.opentimestamps.v1")
	req.Header.Set("User-Agent", "ideatrail-engine")
	res, err := hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, errors.New("calendar refused")
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, responseCap+1))
	if err != nil || len(b) > responseCap {
		return nil, errors.New("calendar response too large")
	}
	return b, nil
}

// isLoopbackTestURL lets tests point at httptest servers; production URLs must be allowlisted.
var isLoopbackTestURL = func(string) bool { return false }

// AllowLoopbackForTesting lets other packages' tests use httptest calendars; returns a restore func.
func AllowLoopbackForTesting() func() {
	prev := isLoopbackTestURL
	isLoopbackTestURL = func(u string) bool { return len(u) > 16 && u[:17] == "http://127.0.0.1:" }
	return func() { isLoopbackTestURL = prev }
}
