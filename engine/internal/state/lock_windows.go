//go:build windows

package state

import (
	"errors"
	"os"
	"time"

	"golang.org/x/sys/windows"
)

const noFollow = 0

// LockTimeout bounds how long a caller waits for another engine process.
var LockTimeout = 30 * time.Second

var ErrLockTimeout = errors.New("state is locked by another engine process")

// syncDir: MOVEFILE_WRITE_THROUGH already flushed the rename.
func syncDir(string) error { return nil }

func lock(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	h := windows.Handle(f.Fd())
	ol := new(windows.Overlapped)
	deadline := time.Now().Add(LockTimeout)
	for {
		err := windows.LockFileEx(h, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, ol)
		if err == nil {
			break
		}
		if !errors.Is(err, windows.ERROR_LOCK_VIOLATION) || time.Now().After(deadline) {
			f.Close()
			if errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
				return nil, ErrLockTimeout
			}
			return nil, err
		}
		time.Sleep(5 * time.Millisecond)
	}
	return func() {
		_ = windows.UnlockFileEx(h, 0, 1, 0, ol)
		_ = f.Close()
	}, nil
}

// replace retries briefly: another process (antivirus, indexer) may hold the target open.
func replace(tmp, dst string) error {
	from, err := windows.UTF16PtrFromString(tmp)
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(dst)
	if err != nil {
		return err
	}
	for i := 0; ; i++ {
		err = windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
		if err == nil || i >= 5 {
			return err
		}
		time.Sleep(time.Duration(20*(i+1)) * time.Millisecond)
	}
}
