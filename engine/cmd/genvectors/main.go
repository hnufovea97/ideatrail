// Command genvectors writes the shared crypto test vectors into spec/vectors.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"ideatrail/engine/internal/crypto"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: genvectors <spec/vectors dir>")
		os.Exit(2)
	}
	files, err := crypto.BuildVectors()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for name, b := range files {
		if err := os.WriteFile(filepath.Join(os.Args[1], name), b, 0o644); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println("wrote", name)
	}
}
