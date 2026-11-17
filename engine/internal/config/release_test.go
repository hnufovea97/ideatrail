//go:build !devbuild

package config

import "testing"

func TestReleaseIgnoresEnvironment(t *testing.T) {
	t.Setenv("IDEATRAIL_API_BASE", "http://127.0.0.1:9")
	if API() != APIBase || Dev() {
		t.Fatal("release build must ignore the environment")
	}
	if ReleaseReady() {
		t.Fatal("release build without a release key must not be ready")
	}
}
