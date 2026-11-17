//go:build devbuild

package home

import "os"

// EnvHome overrides the engine folder in dev builds (tests, local experiments).
const EnvHome = "IDEATRAIL_HOME"

func devHome() string { return os.Getenv(EnvHome) }
