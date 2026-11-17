// Package home locates and prepares the engine folder (spec §13): owner-only, never inside a
// synced folder (Syncthing, iCloud, OneDrive, Dropbox, Google Drive).
package home

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

var ErrSyncedFolder = errors.New("engine folder is inside a synced folder")

// Dir returns the engine folder path (not created).
func Dir() (string, error) {
	if d := devHome(); d != "" { // dev builds only (home_dev.go)
		return filepath.Abs(d)
	}
	switch runtime.GOOS {
	case "windows":
		if d := os.Getenv("LOCALAPPDATA"); d != "" { // not roaming %APPDATA%
			return filepath.Join(d, "ideatrail"), nil
		}
		return "", errors.New("LOCALAPPDATA not set")
	case "darwin":
		h, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(h, "Library", "Application Support", "ideatrail"), nil
	default:
		d, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(d, "ideatrail"), nil
	}
}

// Ensure creates dir owner-only, refusing synced locations.
func Ensure(dir string) error {
	if synced, why := Synced(dir); synced {
		return fmt.Errorf("%w (%s)", ErrSyncedFolder, why)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return restrictDir(dir)
}
