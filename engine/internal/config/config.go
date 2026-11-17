// Package config holds build-time constants (set with -ldflags -X) and derived locations.
// Environment overrides exist only in builds tagged "devbuild"; release binaries do not contain
// them at all (see config_dev.go / config_release.go).
package config

import (
	"os"
	"path/filepath"

	"ideatrail/engine/internal/home"
)

// Set by -ldflags "-X ideatrail/engine/internal/config.<name>=…".
var (
	Version        = "dev"
	APIBase        = "https://api.ideatrail.dev"
	AppBase        = "https://app.ideatrail.dev"
	GitHubClientID = "Iv23lixnwrvkq3SwATx1" // development GitHub App until the production app exists (F-2)
	ReleasePub     = ""                     // base64url Ed25519 release key; empty = dev build (no self-check)
)

// Dev reports a development build (tagged devbuild): overrides allowed, self-check skipped.
func Dev() bool { return devBuild }

// ReleaseReady: a release build without its release key must refuse to run.
func ReleaseReady() bool { return devBuild || ReleasePub != "" }

// API returns the API base (dev builds may override with IDEATRAIL_API_BASE).
func API() string { return override("IDEATRAIL_API_BASE", APIBase) }

// App returns the web app base (dev builds may override with IDEATRAIL_APP_BASE).
func App() string { return override("IDEATRAIL_APP_BASE", AppBase) }

func override(env, def string) string {
	if v := envOverride(env); v != "" {
		return v
	}
	return def
}

// Paths are the engine's own locations (all denied to the AI and to file reads).
type Paths struct {
	Engine string // keys, state, pending, journal
	Outbox string // GitHub queue (outside the engine folder and any synced folder, spec §13)
	Proofs string // local second copy, default ~/ideatrail-증명
}

// Locate computes the default locations.
func Locate() (Paths, error) {
	eng, err := home.Dir()
	if err != nil {
		return Paths{}, err
	}
	h, err := os.UserHomeDir()
	if err != nil {
		return Paths{}, err
	}
	return Paths{Engine: eng, Outbox: eng + "-outbox", Proofs: filepath.Join(h, "ideatrail-증명")}, nil
}
