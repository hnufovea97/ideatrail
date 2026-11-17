//go:build !windows

package pathguard

import (
	"os"
	"syscall"
)

// hardLinked rejects files with more than one name (a hard link could alias engine.key).
func hardLinked(fi os.FileInfo) bool {
	st, ok := fi.Sys().(*syscall.Stat_t)
	return !ok || st.Nlink > 1
}
