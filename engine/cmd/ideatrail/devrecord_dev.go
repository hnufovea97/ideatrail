//go:build devbuild

package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"ideatrail/engine/internal/record"
)

// dev-record records files directly (staging checks only; not in release binaries).
func init() {
	extra["dev-record"] = func(args []string) int {
		if len(args) == 0 {
			fmt.Fprintln(os.Stderr, "dev-record <file>...")
			return 2
		}
		e, err := buildEngine()
		if err != nil {
			fmt.Fprintln(os.Stderr, msgStartFailed)
			return 1
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		r, err := record.Record(ctx, e.Record, record.Input{Paths: args, Milestone: "none"})
		if err != nil {
			fmt.Fprintln(os.Stderr, "record failed:", err)
			return 1
		}
		e.Tick(ctx)
		fmt.Println("recorded", r.Status)
		return 0
	}
}
