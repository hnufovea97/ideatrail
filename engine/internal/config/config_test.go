//go:build devbuild

package config

import "testing"

func TestEnvOverrideInDevBuild(t *testing.T) {
	t.Setenv("IDEATRAIL_API_BASE", "http://127.0.0.1:9")
	if API() != "http://127.0.0.1:9" || !Dev() {
		t.Fatal("dev build should accept override")
	}
}
