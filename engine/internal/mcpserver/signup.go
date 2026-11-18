package mcpserver

import (
	"time"

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

// importBudget bounds the signup first import (one OTS submission per record).
const importBudget = 10 * time.Minute

// firstImportPaths is what the signup first import records: only folders newly registered by the
// signup step 5 choice. Zero chosen, an AI-asked import or a rejection imports nothing.
func firstImportPaths(ev inbox.Event) []string {
	if ev.Kind != "folders_registered" || !ev.Signup {
		return nil
	}
	return ev.Paths
}
