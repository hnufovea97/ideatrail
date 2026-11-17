//go:build !devbuild

package config

const devBuild = false

func envOverride(string) string { return "" }
