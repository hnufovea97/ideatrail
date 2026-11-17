package mcpserver

import (
	"errors"
	"strings"
	"unicode"

	"ideatrail/engine/internal/inbox"
	"ideatrail/engine/internal/pairing"
	"ideatrail/engine/internal/pathguard"
	"ideatrail/engine/internal/record"
)

// Every sentence the AI can receive. Nothing from the server, GitHub, files or errors is ever
// passed through (injection channel), only these fixed texts plus a sanitized folder name.
const (
	msgPairing       = "가입을 브라우저에서 이어 가세요. 끝나면 다시 기록할 수 있어요."
	msgPairingOpened = "브라우저에 가입 화면을 열었어요. 가입을 마치면 기록할 수 있어요."
	msgNotRegistered = "이 폴더는 아직 기록 대상이 아니에요. 대시보드에서 승인하면 기록할 수 있어요."
	msgNotAllowed    = "허용되지 않은 파일이에요(등록된 폴더 밖이거나 비밀 파일)."
	msgBadInput      = "기록 내용이 너무 길거나 형식이 맞지 않아요."
	msgTooLarge      = "파일이 너무 많거나 커요(50개·100MB까지)."
	msgQueueFull     = "올리지 못한 기록이 너무 많아요. 인터넷 연결을 확인해 주세요."
	msgOTSFailed     = "비트코인 시각 서버에 연결하지 못했어요. 잠시 뒤 다시 기록해 주세요."
	msgFailed        = "기록하지 못했어요. 잠시 뒤 다시 시도해 주세요."
	msgImportAsked   = "대시보드에 승인 요청을 보냈어요. 승인하면 그 폴더도 기록돼요."
	msgImportBad     = "그 폴더는 기록 대상으로 쓸 수 없어요(홈 폴더·비밀 폴더 등)."
	msgImportTooMany = "승인을 기다리는 요청이 이미 있어요. 대시보드에서 먼저 처리해 주세요."
	msgPublicRefusal = "공개·삭제·공유는 대시보드에서 직접만 할 수 있어요."
	suffixQueued     = " (인터넷 연결 뒤 자동으로 올라가요)"
	suffixBlocked    = " (서버가 기록을 받지 않아요 — 엔진 업데이트가 필요해요)"
)

var stageLabels = map[string]string{
	"idea": "아이디어", "plan_decided": "기획 확정", "mvp_done": "MVP 완료", "feature_done": "기능 완성", "paused": "잠시 멈춤",
}

func stageLabel(s string) string {
	if l, ok := stageLabels[s]; ok {
		return l
	}
	return "기록 시작"
}

// cleanName keeps a folder name safe for AI context: no control characters or newlines, ≤40 runes.
func cleanName(s string) string {
	var b strings.Builder
	n := 0
	for _, r := range s {
		if unicode.IsControl(r) || r == ' ' || r == ' ' {
			continue
		}
		if n == 40 {
			b.WriteString("…")
			break
		}
		b.WriteRune(r)
		n++
	}
	if b.Len() == 0 {
		return "아이디어"
	}
	return b.String()
}

func recordError(err error) string {
	switch {
	case errors.Is(err, record.ErrNotPaired), errors.Is(err, pairing.ErrAlreadyPaired):
		return msgPairing
	case errors.Is(err, record.ErrNotRegistered):
		return msgNotRegistered
	case errors.Is(err, pathguard.ErrNotAllowed), errors.Is(err, record.ErrMixedFolders):
		return msgNotAllowed
	case errors.Is(err, record.ErrBadInput), errors.Is(err, record.ErrNoFiles):
		return msgBadInput
	case errors.Is(err, record.ErrTooMany), errors.Is(err, record.ErrTooLarge):
		return msgTooLarge
	case errors.Is(err, record.ErrQueueFull):
		return msgQueueFull
	case isOTS(err):
		return msgOTSFailed
	default:
		return msgFailed
	}
}

func importError(err error) string {
	switch {
	case errors.Is(err, inbox.ErrTooMany):
		return msgImportTooMany
	case errors.Is(err, inbox.ErrNotPaired):
		return msgPairing
	default:
		return msgImportBad
	}
}
