package mcpserver

import (
	"ideatrail/engine/internal/inbox"
	"ideatrail/engine/internal/pathguard"
)

// maxSuggestions keeps the signup list (project + suggestions) within what RequestImport takes.
const maxSuggestions = inbox.MaxFolders - 1

// signupFolders is the signup step 5 list: the Claude Code project first, then idea-looking
// siblings. A project the guard refuses (or none) gets no suggestions, so nothing is ever shown
// as if it were the current project.
func signupFolders(project, stateDir, home string) []string {
	if project == "" || pathguard.ValidateFolder(project, stateDir) != nil {
		return nil
	}
	return append([]string{project}, inbox.SuggestFolders(project, stateDir, home, maxSuggestions)...)
}
