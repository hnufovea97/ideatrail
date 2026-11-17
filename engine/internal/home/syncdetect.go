package home

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Synced reports whether p (or the nearest existing ancestor) lies in a synced folder, and why.
func Synced(p string) (bool, string) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return false, ""
	}
	real := resolveExisting(abs) // symlinked paths are judged by where they really point
	for _, candidate := range []string{abs, real} {
		if ok, why := syncedByMarker(candidate); ok {
			return true, why
		}
		if ok, why := syncedByLocation(candidate); ok {
			return true, why
		}
	}
	return false, ""
}

// resolveExisting resolves symlinks for the longest existing prefix of p.
func resolveExisting(p string) string {
	rest := ""
	cur := p
	for {
		if r, err := filepath.EvalSymlinks(cur); err == nil {
			return filepath.Join(r, rest)
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return p
		}
		rest = filepath.Join(filepath.Base(cur), rest)
		cur = parent
	}
}

// syncedByMarker walks ancestors for sync-tool marker folders.
func syncedByMarker(p string) (bool, string) {
	for cur := p; ; cur = filepath.Dir(cur) {
		for _, m := range []string{".stfolder", ".dropbox", ".dropbox.cache", ".sync", ".owncloudsync.log", ".sync_journal.db"} {
			if _, err := os.Stat(filepath.Join(cur, m)); err == nil {
				return true, "marker " + m
			}
		}
		if filepath.Dir(cur) == cur {
			return false, ""
		}
	}
}

func syncedByLocation(p string) (bool, string) {
	var roots []string
	if h, err := os.UserHomeDir(); err == nil {
		roots = append(roots,
			filepath.Join(h, "Library", "Mobile Documents"), // iCloud
			filepath.Join(h, "Library", "CloudStorage"),     // iCloud Drive, OneDrive, Google Drive, Dropbox (File Provider)
			filepath.Join(h, "Dropbox"),
			filepath.Join(h, "Google Drive"),
			filepath.Join(h, "OneDrive"),
			filepath.Join(h, "Box"),
			filepath.Join(h, "pCloud Drive"),
			filepath.Join(h, "Nextcloud"),
		)
		// iCloud "Desktop & Documents": the folders keep their plain paths but are synced.
		if _, err := os.Stat(filepath.Join(h, "Library", "Mobile Documents", "com~apple~CloudDocs", "Desktop")); err == nil {
			roots = append(roots, filepath.Join(h, "Desktop"), filepath.Join(h, "Documents"))
		}
	}
	for _, env := range []string{"OneDrive", "OneDriveConsumer", "OneDriveCommercial"} {
		if v := os.Getenv(env); v != "" {
			roots = append(roots, v)
		}
	}
	for _, r := range roots {
		if within(p, r) {
			return true, "location " + filepath.Base(r)
		}
	}
	return false, ""
}

// within compares paths, ignoring case on case-insensitive systems (APFS default, NTFS).
func within(p, root string) bool {
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		p, root = strings.ToLower(p), strings.ToLower(root)
	}
	rel, err := filepath.Rel(root, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
