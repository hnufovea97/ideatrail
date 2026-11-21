package mcpserver

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Every fixed sentence the AI relays to the person must read plainly for a non-developer
// (G1 feedback): the friendly words, no coin talk, no engine or crypto jargon.
var jargon = regexp.MustCompile(`비트코인|코인|엔진|패스키|PRF|봉투|HPKE|서명|MCP|OTS`)

func TestFixedSentencesUsePlainWords(t *testing.T) {
	all := []string{msgPairing, msgPairingOpened, msgPairingFailed, msgNotRegistered, msgNotAllowed, msgBadInput, msgTooLarge,
		msgQueueFull, msgOTSFailed, msgFailed, msgImportAsked, msgImportBad, msgImportTooMany, msgPublicRefusal,
		suffixQueued, suffixBlocked}
	for _, s := range all {
		if jargon.MatchString(s) || strings.Contains(s, "\n") {
			t.Errorf("not plain: %q", s)
		}
	}
}

func TestPairingSaysBrowserOpenedAboutFiveMinutesComeBack(t *testing.T) {
	for _, want := range []string{"브라우저", "약 5분", "돌아와"} {
		if !strings.Contains(msgPairingOpened, want) {
			t.Errorf("msgPairingOpened %q lacks %q", msgPairingOpened, want)
		}
	}
	if !strings.Contains(msgPairing, "브라우저") {
		t.Errorf("msgPairing %q does not say where to go", msgPairing)
	}
}

func TestRecordWithoutMilestoneNamesNoStage(t *testing.T) {
	e := newEnv(t, true)
	p := filepath.Join(e.folder, "notes.md")
	_ = os.WriteFile(p, []byte("# notes"), 0o600)
	out, isErr := e.call(t, "record", map[string]any{"paths": []string{p}, "note": "메모 정리"})
	if isErr || !strings.HasPrefix(out, "기록했어요 · ") || strings.Contains(out, "단계") || strings.Contains(out, stageLabel("")) {
		t.Fatalf("%q", out)
	}
}
