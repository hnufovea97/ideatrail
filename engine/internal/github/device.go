package github

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// VerificationURL is fixed: the response's verification_uri is never opened (phishing).
const VerificationURL = "https://github.com/login/device"

var (
	ErrDenied        = errors.New("github access was declined")
	ErrExpired       = errors.New("github code expired")
	ErrTokenExpires  = errors.New("github app issues expiring tokens; turn off token expiration in the app settings")
	ErrDeviceRefused = errors.New("github refused the device login")
)

// DeviceFlow holds the endpoints (tests replace them) and user-facing actions.
type DeviceFlow struct {
	ClientID string
	CodeURL  string // https://github.com/login/device/code
	TokenURL string // https://github.com/login/oauth/access_token
	Open     func(link string) error
	ShowCode func(code string) error // clipboard + on-screen dialog; never the AI
	Sleep    func(context.Context, time.Duration) error
}

// DefaultDeviceFlow uses github.com.
func DefaultDeviceFlow(clientID string, open, show func(string) error) *DeviceFlow {
	return &DeviceFlow{ClientID: clientID, CodeURL: "https://github.com/login/device/code",
		TokenURL: "https://github.com/login/oauth/access_token", Open: open, ShowCode: show, Sleep: sleepCtx}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Login runs the device flow and returns a non-expiring user token.
func (f *DeviceFlow) Login(ctx context.Context) (string, error) {
	var dc struct {
		DeviceCode string `json:"device_code"`
		UserCode   string `json:"user_code"`
		ExpiresIn  int    `json:"expires_in"`
		Interval   int    `json:"interval"`
	}
	if err := postForm(ctx, f.CodeURL, url.Values{"client_id": {f.ClientID}}, &dc); err != nil || dc.DeviceCode == "" || !validUserCode(dc.UserCode) {
		return "", ErrDeviceRefused
	}
	if err := f.ShowCode(dc.UserCode); err != nil {
		return "", err
	}
	if err := f.Open(VerificationURL); err != nil {
		return "", err
	}
	interval := time.Duration(max(dc.Interval, 5)) * time.Second
	deadline := time.Now().Add(time.Duration(min(max(dc.ExpiresIn, 60), 900)) * time.Second)
	for time.Now().Before(deadline) {
		if err := f.Sleep(ctx, interval); err != nil {
			return "", err
		}
		var tok struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    *int   `json:"expires_in"`
			Error        string `json:"error"`
		}
		if err := postForm(ctx, f.TokenURL, url.Values{"client_id": {f.ClientID}, "device_code": {dc.DeviceCode},
			"grant_type": {"urn:ietf:params:oauth:grant-type:device_code"}}, &tok); err != nil {
			var he *Error
			if errors.As(err, &he) && he.Status >= 400 && he.Status < 500 && he.Status != 429 {
				return "", ErrDeviceRefused // a refusal will not change by asking again
			}
			continue // transient network problem: keep polling until the deadline
		}
		switch tok.Error {
		case "authorization_pending":
			continue
		case "slow_down":
			interval += 5 * time.Second
			continue
		case "access_denied":
			return "", ErrDenied
		case "expired_token":
			return "", ErrExpired
		case "":
		default:
			return "", ErrDeviceRefused
		}
		if tok.RefreshToken != "" || tok.ExpiresIn != nil {
			return "", ErrTokenExpires // M0 S4: the app must opt out of token expiration
		}
		if tok.AccessToken == "" || len(tok.AccessToken) > 255 {
			return "", ErrDeviceRefused
		}
		return tok.AccessToken, nil
	}
	return "", ErrExpired
}

func validUserCode(s string) bool {
	if len(s) < 6 || len(s) > 12 {
		return false
	}
	for _, c := range s {
		if !((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-') {
			return false
		}
	}
	return true
}

func postForm(ctx context.Context, u string, v url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, "POST", u, strings.NewReader(v.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", userAgent)
	res, err := noRedirect().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return &Error{Status: res.StatusCode}
	}
	return json.NewDecoder(io.LimitReader(res.Body, 64*1024)).Decode(out)
}
