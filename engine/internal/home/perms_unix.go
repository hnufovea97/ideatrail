//go:build !windows

package home

import (
	"os"
	"syscall"
)

func restrictDir(dir string) error { return os.Chmod(dir, 0o700) }

// RestrictFile makes a file owner-read/write only.
func RestrictFile(path string) error { return os.Chmod(path, 0o600) }

// OwnerOnly reports whether a file belongs to the current user and grants nothing to group or others.
func OwnerOnly(fi os.FileInfo) bool {
	st, ok := fi.Sys().(*syscall.Stat_t)
	return ok && int(st.Uid) == os.Geteuid() && fi.Mode().Perm()&0o077 == 0
}
