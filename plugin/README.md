# ideatrail 플러그인

AI와 작업하는 동안 기획·문서의 변화를 저절로 기록하고 날짜를 증명해 둬요. 내용은 내 기기에서만 잠기고 풀려요.

## 설치

```
/plugin marketplace add <배포 저장소>
/plugin install ideatrail@ideatrail
```

지금은 Mac만 지원해요. Windows는 베타 뒤에 와요.

## 업데이트

새 버전이 나오면 대시보드에서 바뀐 점을 보고 승인해야 기록이 이어져요.

## 토큰 예산

도구 설명과 기록 규칙 스킬이 매 세션에 차지하는 몫은 합계 1,500토큰, 스킬은 600토큰 이하여야 해요.
`scripts/measure-tokens.mjs`가 `plugin/tools.json`(서버가 알리는 도구 목록과 같은지 Go 시험이 지켜요)과 `SKILL.md`를 재요.

추정 방법은 일부러 넉넉한(상한) 값이에요: `ceil(ASCII 글자 / 3.5) + ceil(ASCII 아닌 글자 × 1.5)`. 도구는 공백 없는 JSON으로 세요. Claude Code 자체 계산(`plugin details`)은 스킬을 약 450으로 세어 이 값보다 작아요(2026-11-25).

| 항목 | 토큰(상한 추정) |
|---|---:|
| tool record | 642 |
| tool request_import | 96 |
| tool set_record_words | 138 |
| tool status | 68 |
| tools subtotal | 944 |
| skill (record) | 490 |
| total | 1434 |
| 예산 | 합계 1500 · 스킬 600 |

`node scripts/measure-tokens.mjs`로 다시 재요. 예산을 넘기면 종료 코드 1이에요.
