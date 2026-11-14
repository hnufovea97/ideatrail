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
- 2026-11-14 S2 **네이버 웨일 5.41 (Chromium 156, Mac M1)**: caps에 prf true·UVPA true, 패스키 만들기·확인은 성공했지만 **PRF enabled false / get prf 없음** → 웨일이 패스키를 PRF를 지원하지 않는 자체 저장소에 둔 것으로 보임. 한국 사용자 비중이 있어 **M4 가입 화면에서 PRF 없음 감지 → 다른 브라우저(Chrome·Safari)나 휴대폰 QR 경로 안내** 필요. caps의 `extension:prf: true`만으로는 판단 불가(실제 결과로 판정).
- 2026-11-14 S2 **Safari 26.6.2 (Mac M1) 2차 ✅**: 첫 시도 NotAllowedError(1회) 뒤 재시도 성공. create 시점 PRF 결과 `88d469ee…2376`, get 결과 동일 → **같은 패스키·같은 salt면 같은 값**(열쇠 풀기 재현 가능). UVPA false 상태였음 → 저장 위치(iCloud 키체인/휴대폰 QR) founder 확인 중. 첫 실패 1회는 가입 화면에서 "다시 시도" 버튼으로 흡수.
- 2026-11-14 S2 Google Chrome: founder Mac에 설치 안 됨 → 이번 M0에선 건너뜀. Windows Phase B(Chrome·Edge)와 베타 전 다른 Mac에서 재확인.

## S4 GitHub App 기기 코드 연결 (Mac, 2026-11-14) — 앱 `ideatrail-dev`, client_id `Iv23lixnwrvkq3SwATx1`
| 확인 | 결과 |
|---|---|
| 기기 코드 로그인 | ✅ 사용자 동작 = 계정 [Continue] → 8자리 코드 → [Authorize] 3번 클릭. 코드 칸은 한 글자씩 입력(붙여넣기 권장) |
| 출입증 만료 끄기 | ⚠️ 새 앱 만들기 화면에서 끈 줄 알았는데 **기본값 켜짐**으로 저장됨(만료 있음 true, 8시간). 앱 설정 **Optional features → User-to-server token expiration → Opt-out** 후 재로그인 → **만료 있음 false** ✅. 설정 초안 §3에 이 경로를 적어야 함 |
| 저장소 만들기 (H17) | 앱 설치 전: `POST /user/repos` **403 Resource not accessible by integration**. 설치 후(Only select): 같은 요청이 **422 이름 중복**(권한 검사는 통과). 실제 새 저장소 생성 여부는 새 이름 1개로 한 번 더 확인 필요 → founder 승인 대기 |
| 설치 범위 확인 | ✅ `/user/installations/{id}/repositories`로 선택 저장소(`ideatrail-spike`)만 보임 |
| 동시 묶음 커밋 (§3.1.10 F) | ✅ A·B 동시 시도 → B 성공, A "앞서 바뀜"(422) → 다시 시도 성공. force 없음, 커밋 2개·파일 6개 모두 남음, 덮어쓰기 0 |
| 출입증 보관 | 임시 폴더 0600 파일, 값 출력 0 |
| 저장소 만들기 재확인 (H17) | ✅ 설치 후 새 이름 `ideatrail-spike-2`로 `POST /user/repos` → **비공개 저장소 생성 성공**, 그리고 **앱 설치 범위에 자동 포함**(Only select인데도). 결론: 가입 때 "앱 설치(저장소 1개 선택) → 엔진이 기록용 저장소 자동 생성" 가능. Administration: Read & write는 유지(저장소 만들기에 필요). 설치 전엔 403이므로 **설치가 먼저** |
