//go:build windows

package pathguard

import "os"

// hardLinked: link counts need a handle query on Windows; the engine folder's DACL and the
// deny list cover engine.key there. Revisit in the Windows test pass (M6).
func hardLinked(os.FileInfo) bool { return false }
