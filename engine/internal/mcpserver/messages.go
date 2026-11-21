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
	msgPairing       = "가입이 아직 안 끝났어요. 앞서 열린 브라우저 창에서 이어 가 주세요(약 5분). 다 마치면 여기로 돌아와 다시 말해 주세요."
	msgPairingFailed = "가입을 시작하지 못했어요. 인터넷 연결을 확인하고 잠시 뒤 다시 말해 주세요. 계속 안 되면 Claude Code를 닫았다가 다시 켜 주세요."
	msgPairingOpened = "가입하려고 브라우저 창을 열었어요. 약 5분이면 끝나요. 화면이 하라는 대로 마친 뒤 여기 Claude Code로 돌아와 주세요."
	msgNotRegistered = "이 폴더는 아직 기록하지 않는 폴더예요. 대시보드에서 이 폴더를 허락하면 기록할 수 있어요."
	msgNotAllowed    = "이 파일은 기록할 수 없어요. 기록하기로 고른 폴더 밖에 있거나, 비밀번호 같은 비밀 파일이에요."
	msgBadInput      = "기록 설명이 너무 길거나 형식이 맞지 않아요. 짧게 다시 정리해 주세요."
	msgTooLarge      = "한 번에 기록하기엔 파일이 너무 많거나 커요. 한 번에 50개, 100MB까지예요."
	msgQueueFull     = "아직 보내지 못한 기록이 너무 많이 쌓였어요. 인터넷 연결을 확인해 주세요."
	msgOTSFailed     = "날짜 증명 서버에 연결하지 못했어요. 잠시 뒤 다시 기록해 주세요."
	msgFailed        = "기록하지 못했어요. 잠시 뒤 다시 해 주세요."
	msgImportAsked   = "대시보드에 '이 폴더도 기록할까요?' 요청을 보냈어요. 허락하면 그 폴더도 기록돼요."
	msgImportBad     = "그 폴더는 기록할 수 없어요(홈 폴더 전체나 비밀 폴더 등)."
	msgImportTooMany = "아직 답하지 않은 요청이 있어요. 대시보드에서 먼저 답해 주세요."
	msgPublicRefusal = "공개로 바꾸기·지우기·공유는 대시보드에서 본인만 직접 할 수 있어요."
	suffixQueued     = " (인터넷이 연결되면 저절로 올라가요)"
	suffixBlocked    = " (지금은 서버가 기록을 받지 않아요. 기록 도우미를 업데이트해 주세요)"
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
