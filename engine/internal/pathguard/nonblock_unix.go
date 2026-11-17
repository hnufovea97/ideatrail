//go:build !windows

package pathguard

import "syscall"

const nonBlock = syscall.O_NONBLOCK
