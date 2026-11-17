//go:build windows

package pathguard

import "errors"

func mkfifo(string) error { return errors.New("no fifo") }
