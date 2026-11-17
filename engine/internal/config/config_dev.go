//go:build devbuild

package config

import "os"

const devBuild = true

func envOverride(name string) string { return os.Getenv(name) }
