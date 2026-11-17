//go:build !windows

package pathguard

import "syscall"

func mkfifo(p string) error { return syscall.Mkfifo(p, 0o600) }
