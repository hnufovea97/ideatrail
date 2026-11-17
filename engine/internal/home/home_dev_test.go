//go:build devbuild

package home

import "testing"

func TestDirOverride(t *testing.T) {
	t.Setenv(EnvHome, "/tmp/x-ideatrail")
	if d, _ := Dir(); d != "/tmp/x-ideatrail" {
		t.Fatalf("got %s", d)
	}
}
