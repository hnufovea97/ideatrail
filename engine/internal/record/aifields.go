package record

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// The AI's optional counts and short lines on a record (ADR-0019). They are content: they go only into
// the sealed kind 1 list meta, never in plain to the server. The text check follows ADR-0016 (record
// words): letters of Hangul, Latin and Han, ASCII digits, spaces and a little punctuation — no quotes,
// newlines, control or bidi characters, nothing that could close a quote or open markup.
const (
	maxCount    = 999
	maxTurnLen  = 40
	maxLabelLen = 20
	linePunct   = "?!~.,·-()/:"
)

// plainLine reports whether s is one short plain line with at least one letter or digit.
func plainLine(s string) bool {
	hasLetter := false
	for _, r := range s {
		switch {
		case unicode.In(r, unicode.Hangul, unicode.Latin, unicode.Han), r >= '0' && r <= '9':
			hasLetter = true
		case r == ' ' || strings.ContainsRune(linePunct, r):
		default:
			return false
		}
	}
	return hasLetter
}

func countOK(n *int) bool { return n == nil || (*n >= 0 && *n <= maxCount) }

// lineOK: empty means "not given"; anything else must be a plain line within max runes.
func lineOK(s string, max int) bool {
	return s == "" || (utf8.RuneCountInString(s) <= max && plainLine(s))
}

func (in Input) aiFieldsOK() bool {
	return countOK(in.Decided) && countOK(in.Deferred) && lineOK(in.Turn, maxTurnLen) && lineOK(in.Label, maxLabelLen)
}

// withAIFields adds only the fields the AI gave, so older readers see the same shape as before.
func withAIFields(m map[string]any, in Input) map[string]any {
	if in.Decided != nil {
		m["decided"] = *in.Decided
	}
	if in.Deferred != nil {
		m["deferred"] = *in.Deferred
	}
	if in.Turn != "" {
		m["turn"] = in.Turn
	}
	if in.Label != "" {
		m["label"] = in.Label
	}
	return m
}
