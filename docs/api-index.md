# API Index

> **이 파일이 기준**(개발 저장소). `api/test/api-index.test.ts`가 표의 (메서드, 경로)와 실제 Hono 경로를 대조한다 — M2a에서 만든 경로는 모두 표에 있어야 하고, 표에만 있는 경로는 M2b 예정으로 출력된다

> 2026-11-14 계획 · 2026-11-17 M2a 구현 반영(§ 아래 "M2a에서 바뀐 것")
> 인증: **세션** = 패스키 로그인 쿠키(HttpOnly·Secure·SameSite=Strict, `app.`↔`api.` 같은 사이트) · **재확인** = 본문 `assertion` + 2분 안 stepup 도전값 · **엔진 서명** = 규격 §8 (`X-IT-*` 헤더, req_seq 증가·±5분) · **없음** = 요청 상한만
> 서버 제약(Workers 무료): Ed25519 검증은 `crypto.subtle`만 · change_seq 올리기 + INSERT는 한 번의 `db.batch()` · API는 엔진의 **MCP 프로세스만** 부른다(훅은 안 부름)

| 메서드 | 경로 | 인증 | 하는 일 | 표 |
|---|---|---|---|---|
| POST | `/v1/pairing` | 없음(IP 상한) | 엔진이 짝 맞추기 시작: engine_id·sign·kem 공개키 → session_id (기기 이름은 링크 `#` 안에만). **이미 있는 engine_id는 거절**(다시 짝 맞추기 = 새 engine_id) | pairing_sessions, engines |
| GET | `/v1/pairing/:id` | 없음(IP 상한) | 가입 화면이 엔진 공개키 받기(링크 `#` 지문과 대조) | pairing_sessions |
| POST | `/v1/webauthn/register/options` · `/v1/webauthn/register/verify` | 셋 중 하나: 짝 세션 `{pairing_session_id}` · 기기 추가 `{device_add_session_id, join_secret}`(PC가 key를 올린 뒤) · 복구 `{recovery_challenge_id, proof}`(RK 검증 열쇠 서명) — IP 상한 | 패스키 등록 → (짝 세션이면) 계정 생성(확정 전), 봉투 저장, 세션 쿠키 | users, passkey_credentials, key_envelopes, webauthn_challenges |
| POST | `/v1/account/confirm` | 세션 | 같은 기기에서 봉투를 한 번 풀어 본 뒤 계정 확정(그전엔 기록 거절) | users |
| POST | `/v1/pairing/:id/deliver` | 세션(확정된 계정) | **가입 ① 직후**(세션 10분 안) 브라우저 → 엔진: {user_id, account_pubkey} kem 봉인 + 짝 비밀값 HMAC + 새 `engine_list`·`engine_list_version`(이전+1) → 서버가 `engines`(INSERT만, last_req_seq 옮김)·`connectors` 줄 생성 + `UPDATE users … WHERE engine_list_version=?` 조건부 | pairing_sessions, engines, connectors, users |
| GET | `/v1/pairing/:id/blob` | 엔진 서명(**세션의 sign_pubkey + 세션 last_req_seq**) | 엔진이 전달물 받기 | pairing_sessions |
| GET | `/v1/account` | 세션 | 잠금 해제 뒤 계정 줄: `wrapped_account_privkey`, `engine_list`+`engine_list_version`, 보기 설정·점검 카드 상태, `recall_notes` + 봉투 이름표(재잠금 label) + 패스키 메타(credential_id·aaguid·만든 날·마지막 사용) | users, key_envelopes, passkey_credentials |
| POST | `/v1/webauthn/login/options` · `/v1/webauthn/login/verify` | 없음(IP 상한) | 로그인 + 그 패스키의 봉투 내려받기 + 세션 쿠키 | key_envelopes, webauthn_challenges, sessions |
| POST | `/v1/webauthn/stepup/options` | 세션 | **패스키 재확인**용 도전값(2분) — 본문 `{method, path}`로 **그 동작 하나에 묶임**. 보호 경로는 본문에 `assertion`을 넣음 | webauthn_challenges |
| POST | `/v1/logout` | 세션 | 세션 삭제 | sessions |
| PUT | `/v1/envelopes` | 세션 + 재확인 | 복구 봉투 추가·교체 (`lookup_hash` = SHA-256(lookup_id), `verify_pubkey` = RK에서 만든 Ed25519 공개키 → `kdf_params.vk`) | key_envelopes |
| POST | `/v1/recovery/envelope` | 없음(IP 상한) | `lookup_id` → 서버가 해시해 찾음 → 복구 봉투 + **5분 복구 도전값**(`recovery_challenge_id`, `challenge`) → 브라우저가 RK 검증 열쇠로 `challenge`에 서명해 `register/options`에 냄 | key_envelopes, webauthn_challenges |
| POST | `/v1/device-add` | 세션 | PC가 기기 추가 세션 만들기 (QR에 1회용 비밀값) | device_add_sessions |
| POST | `/v1/device-add/:id/join` | 없음(IP 상한, 2분·1회) | 새 기기 임시 공개키 + 비밀값 HMAC → 1회용 `join_secret`(서버는 해시만) | device_add_sessions |
| GET | `/v1/device-add/:id` | 세션(만든 사람) | PC가 join 상태·임시 공개키·HMAC 읽기 | device_add_sessions |
| POST/GET | `/v1/device-add/:id/key` | 세션(만든 사람) / 새 기기(`X-IT-Join-Secret`, IP 상한) | PC가 마스터 키를 HPKE로 봉인해 올림(1회) / 새 기기가 받음 → `register/*`로 패스키 등록 | device_add_sessions, key_envelopes |
| POST | `/v1/records` | 엔진 서명 | 기록(지문·부모·봉인 목록 정보·대기 영수증·엔진 서명·log_seq) — record_id 중복은 1번만. `INSERT OR IGNORE INTO roots` 뒤 **`roots.user_id`가 엔진의 user_id와 다르면 거절** | roots, records, anchors |
| POST | `/v1/deltas` | 엔진 서명 | 변경 조각 (루트당 안 합친 조각 500 상한). roots 처리는 `/v1/records`와 같음 | roots, meta_deltas |
| GET | `/v1/anchors/confirmed?since=` | 엔진 서명 / 세션 | 확정 영수증 받기 | anchors |
| POST | `/v1/anchors/:record_id/synced` | 엔진 서명 / 세션 | `local`(엔진만) 또는 `repo` 반영 표시 | anchors |
| PUT | `/v1/storage-link` | 엔진 서명 | 엔진이 받은 GitHub 출입증을 계정 공개키로 봉인 + `ideatrail-v1-storagelink` 서명해 저장(엔진마다) | storage_links |
| POST | `/v1/repo-heads` | 엔진 서명 / 세션 | 마지막으로 본 커밋 지문 서명 보고 → 지워짐 감지 | repo_heads |
| GET | `/v1/import-allowance` | 엔진 서명 | 가입 가져오기 1회 허용량 | import_allowances |
| POST | `/v1/approvals` | 엔진 서명 | 승인 대기 만들기(가져오기·폴더 추가·원문 지우기·연결 끊기·**가입 ⑤ 추천 폴더 `signup_select`**, kind 10/11, appr_seq) | pending_approvals |
| GET | `/v1/approvals` | 세션 | 승인 대기 목록 받기(가입 ⑤ 화면은 `signup_select`를 여기서 받음 — 선택은 `POST /v1/inbox`) | pending_approvals |
| POST | `/v1/approvals/:id/decide` | 세션 + 재확인 | 대시보드에서 승인·거절 → 엔진 전달함으로 | pending_approvals, engine_inbox |
| GET | `/v1/inbox` | 엔진 서명 | 엔진 전달함 읽기(최대 100통) | engine_inbox |
| DELETE | `/v1/inbox/:id` | 엔진 서명 | 처리한 메시지 지우기(자기 것만) | engine_inbox |
| POST | `/v1/inbox` | 세션 | 브라우저 → 엔진 메시지(GitHub 연결 요청·가입 ⑤ 선택 등) — **HPKE Auth 모드(AK)**라 서버 위조 불가 | engine_inbox |
| GET | `/v1/sync?cursor=&limit=` | 세션 | 바뀐 것만 받기: roots·records·deltas·anchors·engines·**storage_links·pending_approvals** (user_id, 순번 커서). `limit` 기본 200, 응답에 `next_cursor`(더 없으면 null) | 여러 표 |
| POST | `/v1/roots/:id/meta` | 세션 | 합친 목록 정보 저장 (meta_version 조건부) | roots, meta_deltas |
| POST | `/v1/visibility` | 세션 + 재확인 | 공개·비공개 전환 | roots, records |
| POST | `/v1/engines/:id/revoke` | 세션 + 재확인 | 엔진 끊기: 서명 열쇠 폐기 + (본문의) 그 엔진 출입증으로 GitHub 취소 1회 후 버림 + 그 엔진을 뺀 새 `engine_list`·`engine_list_version`(이전+1) 조건부 저장 | engines, storage_links, users |
| POST | `/v1/engines/:id/pause` | 세션 | 사용자 일시 정지(`pause_reason=user`), 단계 확인 없음 — 멈추기는 안전 쪽 | engines |
| POST | `/v1/engines/:id/resume` | 세션 | 일시 정지 풀기 | engines |
| POST | `/v1/credentials/:id/remove` | 세션 + 재확인 | 기기 잠금 하나 빼기(봉투 함께 삭제). 마지막 1대면 409 `last_device` | passkey_credentials, key_envelopes |
| PUT | `/v1/prefs` | 세션 | 보기 설정·기억 메모·점검 카드 상태(모두 봉인), 자동 잠금 분(1·3·5) | users |
| DELETE | `/v1/account` | 세션 + 재확인 | 계정 지우기(감사 로그·사용 지표 개인 줄 포함) | 전부 |
| POST | `/v1/events` | 세션 | 사용 지표(내용 없음) | usage_events |
| (Cron) | 매 n분 | — | 대기 영수증의 확정본 받아 오기 — 한 번에 기록 **50 ÷ 달력 서버 수** 개 이하(하위 요청 50 상한) | anchors |

**없는 것(의도):** AI 커넥터용 공개 전환·삭제·공유 경로 0 · 서버가 GitHub에 쓰는 경로 0 · 메일 경로 0(1b)

## M2a에서 바뀐 것 (2026-11-17, ECC 보안 검토 반영)
- 모든 브라우저 쓰기(GET 아닌 것)는 `Origin`이 정확히 APP_ORIGIN + `content-type: application/json` (CSRF). 엔진 서명 경로는 예외
- 오류 형식 `{"error":{"code","message"}}`, 본문 64KB 상한(413), 로그는 경로 패턴만
- 세션 쿠키 `__Host-it_s` 12시간, DB에는 SHA-256만
- 기기 추가: `d`만으로는 못 붙임(`join_secret` + PC가 key를 올린 뒤) · 복구: lookup_id만으로는 못 붙임(RK 검증 열쇠 서명)
- 재확인은 `METHOD /path` 하나에 묶임
