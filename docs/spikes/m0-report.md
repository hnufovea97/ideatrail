# M0 실험 보고서 (작성 중)

| 실험 | 상태 | 결과 |
|---|---|---|
| S1 OTS 직접 제출 | 제출 완료 (2026-11-14 15:44) · 확정본 확인 대기 | 공용 서버 3곳 모두 200 (172·205·156바이트 대기 영수증). 공식 `ots stamp`도 4곳 제출. 몇 시간 뒤 `ots upgrade` → 블록 탐색기 2곳 대조 |
| S2 패스키 PRF | founder 기기 시험 대기 (Phase A Mac → Phase B Windows) | — |
| S3 서명 없는 실행 (Mac) | ✅ | git clone한 arm64 바이너리 경고 없이 실행. `com.apple.quarantine` 없음(provenance만). `spctl` 평가는 rejected지만 quarantine이 없어 실행은 막지 않음 → ADR-0001 Mac 유지 가능. 브라우저로 받은 파일은 다를 수 있음 → M6 실제 `/plugin install` 경로로 재확인 |
| S3 서명 없는 실행 (Windows) | 저장소 준비됨(2026-11-14 승인, 비공개 `hnufovea97/ideatrail-s3`) → Phase B에서 Windows clone·실행 | — |
| S4 GitHub 기기 코드·저장소 생성 | F-2(GitHub App 등록) 대기 | 코드 준비·Mac/Windows 빌드 확인. 토큰은 화면에 출력하지 않음 |

## 라이브러리 후보 (S1 Step 4, 1차)
- Go: `github.com/nbd-wtf/opentimestamps` (esplora HTTP 검증 지원) — 최근 커밋·라이선스 확인 필요
- TS: `javascript-opentimestamps`(공식), `@otskit/client`(esplora 검증) — 유지 상태 확인 필요

## 메모
- 2026-11-14 founder 지시로 커밋 작성자 이메일을 `fovea@nate.com`으로 바꾸고 push 전 커밋 전체를 다시 썼어요(개발 저장소 12개, S3 저장소 1개).
- 비공개 임시 저장소 2개 생성 승인 받음. `ideatrail-s3` 생성·push 완료, `ideatrail-spike`는 F-2 client_id를 받은 뒤 S4가 만들어요.
- 2026-11-14 S2 Safari 1차: caps `extension:prf: true`, `userVerifyingPlatformAuthenticator: false`, 창 없이 `NotAllowedError`. 원인 추정 = 클릭 뒤 `await getClientCapabilities()`가 먼저 돌아 Safari의 사용자 동작이 끊김. **M4 가입 화면 규칙: 버튼 클릭 처리기에서 다른 await 없이 바로 `credentials.create/get` 호출**. 페이지를 만들기·확인 두 버튼으로 고쳐 재시험.
