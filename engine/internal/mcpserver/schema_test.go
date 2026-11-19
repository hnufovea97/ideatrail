package mcpserver

import (
	"strings"
	"testing"
)

// The signup page promises "기억해 줘 한마디면 돼요": an idea that lives only in the chat must still be recordable,
// so the record tool tells the AI to save it as a note file first (the engine fingerprints files only).
func TestRecordDescriptionCoversRememberRequests(t *testing.T) {
	for _, want := range []string{"기억해 줘", "Markdown note", "why", "ruled out"} {
		if !strings.Contains(recordDescription, want) {
			t.Errorf("recordDescription is missing %q", want)
		}
	}
}
