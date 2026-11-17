//go:build !darwin

package main

// showCode on Windows arrives with the Windows bundle (M6).
func showCode(code string) error { return errBadCode }
