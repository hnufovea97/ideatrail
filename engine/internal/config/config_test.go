package config

import "testing"

func TestEnvOverrideOnlyInDevBuilds(t *testing.T) {
	t.Setenv("IDEATRAIL_API_BASE", "http://127.0.0.1:9")
	Version = "dev"
	if API() != "http://127.0.0.1:9" {
		t.Fatal("dev build should accept override")
	}
	Version = "0.1.0"
	defer func() { Version = "dev" }()
	if API() != APIBase {
		t.Fatal("release build must ignore the environment")
	}
}
