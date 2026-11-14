# M0 실험 보고서 (작성 중)

| 실험 | 상태 | 결과 |
|---|---|---|
| S1 OTS 직접 제출 | 제출 완료 (2026-11-14 15:44) · 확정본 확인 대기 | 공용 서버 3곳 모두 200 (172·205·156바이트 대기 영수증). 공식 `ots stamp`도 4곳 제출. 몇 시간 뒤 `ots upgrade` → 블록 탐색기 2곳 대조 |
| S2 패스키 PRF | founder 기기 시험 대기 (Phase A Mac → Phase B Windows) | — |
| S3 서명 없는 실행 (Mac) | ✅ | git clone한 arm64 바이너리 경고 없이 실행. `com.apple.quarantine` 없음(provenance만). `spctl` 평가는 rejected지만 quarantine이 없어 실행은 막지 않음 → ADR-0001 Mac 유지 가능. 브라우저로 받은 파일은 다를 수 있음 → M6 실제 `/plugin install` 경로로 재확인 |
| S3 서명 없는 실행 (Windows) | 비공개 임시 저장소 승인 대기 → Phase B | — |
| S4 GitHub 기기 코드·저장소 생성 | F-2(GitHub App 등록) 대기 | 코드 준비·Mac/Windows 빌드 확인. 토큰은 화면에 출력하지 않음 |

## 라이브러리 후보 (S1 Step 4, 1차)
- Go: `github.com/nbd-wtf/opentimestamps` (esplora HTTP 검증 지원) — 최근 커밋·라이선스 확인 필요
- TS: `javascript-opentimestamps`(공식), `@otskit/client`(esplora 검증) — 유지 상태 확인 필요
