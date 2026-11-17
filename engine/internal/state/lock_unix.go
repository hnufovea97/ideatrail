//go:build !windows

package state

import (
	"errors"
	"os"
	"time"

	"golang.org/x/sys/unix"
)

const noFollow = unix.O_NOFOLLOW

// LockTimeout bounds how long a caller waits for another engine process.
var LockTimeout = 30 * time.Second

var ErrLockTimeout = errors.New("state is locked by another engine process")

func lock(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|unix.O_NOFOLLOW, 0o600)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(LockTimeout)
	for {
		err = unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			break
		}
		if !errors.Is(err, unix.EWOULDBLOCK) || time.Now().After(deadline) {
			f.Close()
			if errors.Is(err, unix.EWOULDBLOCK) {
				return nil, ErrLockTimeout
			}
			return nil, err
		}
		time.Sleep(5 * time.Millisecond)
	}
	return func() {
		_ = unix.Flock(int(f.Fd()), unix.LOCK_UN)
		_ = f.Close()
	}, nil
}

func replace(tmp, dst string) error { return os.Rename(tmp, dst) }

func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
