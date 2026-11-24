package mcpserver

// Tool descriptions and schemas are the plugin draft §4 text (token budget: ≤1,500 with the skill).
const (
	recordDescription = "Record a meaningful change to an idea (plan decided, feature done, feedback applied), or a moment the user asks to keep (\"기록해 줘\" or in their own words). If it lives only in the conversation, first save it as a short Markdown note in the project folder (what was chosen, why, what was ruled out), then record that file. Not for typo fixes. The engine fingerprints, seals and anchors the files; you only describe."
	statusDescription = "Show this project's idea: stage, empty routine slots, last record. Call before recording if unsure whether it is a new idea."
	importDescription = "Ask to import existing notes from folders. Only shows a list; the user approves on the dashboard."
)

var recordSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"paths":             map[string]any{"type": "array", "items": map[string]any{"type": "string", "maxLength": 1024}, "minItems": 1, "maxItems": 50, "description": "Files inside a registered project folder"},
		"note":              map[string]any{"type": "string", "maxLength": 400, "description": "2-3 sentences: what changed and why"},
		"milestone":         map[string]any{"type": "string", "enum": []string{"none", "idea", "plan_decided", "mvp_done", "feature_done", "paused"}, "default": "none"},
		"milestone_certain": map[string]any{"type": "boolean", "default": false, "description": "true only if the user said it or a checklist/tag shows it"},
		"routine": map[string]any{"type": "array", "maxItems": 7, "items": map[string]any{"type": "object", "additionalProperties": false,
			"properties": map[string]any{"slot": map[string]any{"type": "string", "enum": []string{"problem", "audience", "not_doing", "decision_reason", "first_run", "feedback", "changed_by_feedback"}}, "estimated": map[string]any{"type": "boolean"}},
			"required":   []string{"slot"}}, "description": "Only slots newly evidenced by these files"},
		"tags": map[string]any{"type": "array", "items": map[string]any{"type": "string", "maxLength": 20}, "maxItems": 5, "description": "Only on the first record of a new idea"},
		// ADR-0019: optional, sealed with the list meta. Plain words only (no quotes or line breaks).
		"decided":  map[string]any{"type": "integer", "minimum": 0, "maximum": 999, "description": "How many things were decided in this record"},
		"deferred": map[string]any{"type": "integer", "minimum": 0, "maximum": 999, "description": "How many were put off for later"},
		"turn":     map[string]any{"type": "string", "maxLength": 40, "description": "One line if the direction changed; else omit"},
		"label":    map[string]any{"type": "string", "maxLength": 20, "description": "Version name, e.g. 개요, 초안, 개선 1"},
		// ADR-0020: sent as one sealed fragment, not in the record itself.
		"stages": map[string]any{"type": "array", "items": map[string]any{"type": "string", "maxLength": 12}, "minItems": 5, "maxItems": 5,
			"description": "First record of an idea only: 5 short stage names fitting the work (e.g. writing: 착상·개요·초고·퇴고·발행)."},
	},
	"required":             []string{"paths", "note"},
	"additionalProperties": false,
}

var importSchema = map[string]any{
	"type":                 "object",
	"properties":           map[string]any{"folders": map[string]any{"type": "array", "items": map[string]any{"type": "string", "maxLength": 1024}, "minItems": 1, "maxItems": 5}},
	"required":             []string{"folders"},
	"additionalProperties": false,
}
