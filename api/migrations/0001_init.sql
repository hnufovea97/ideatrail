-- ideatrail D1 초기 스키마 (M2a 확정 — docs/build/spec/d1-0001-init.sql과 같게 유지)
-- 기준: 데이터 모델 초안 §2·§2-11, 설계문서 §3.1.10~§3.1.12, docs/build/spec/암호-통신-규격.md
-- 규칙: 모든 표의 키 앞에 user_id (나중에 DB 나누기), 암호문 칸은 BLOB(형식 IT1…), 시각은 RFC3339 TEXT
--       change_seq = 계정별 증가 커서 → GET /v1/sync?cursor= 가 "바뀐 것만" 받게 함, deleted_at = 지움 표시
--       change_seq 올리기 + INSERT/UPDATE는 한 번의 db.batch()로 (BEGIN/COMMIT 안 씀, 규격 §8)
--       records·meta_deltas 줄은 지우지 않음(지움 표시만, log_seq 빈틈 방지) — 계정 삭제 때만 CASCADE
-- 1a 제외: contact_email·recovery_hint(1b, D-d), chain_checkpoints(1b), password 봉투(없음)

CREATE TABLE users (
  user_id                  TEXT PRIMARY KEY,
  account_pubkey           BLOB NOT NULL,              -- X25519, 평문
  wrapped_account_privkey  BLOB NOT NULL,              -- 재잠금(account_priv)
  recovery_key_status      TEXT NOT NULL DEFAULT 'none' CHECK (recovery_key_status IN ('none','created')),
  auto_lock_minutes        INTEGER NOT NULL DEFAULT 5,
  recall_notes             BLOB,                       -- 재잠금
  reminder_state           BLOB,                       -- 재잠금
  view_prefs               BLOB,                       -- 재잠금
  engine_list              BLOB,                       -- 재잠금(engine_list): 믿는 엔진 공개키 목록 (규격 §8)
  engine_list_version      INTEGER NOT NULL DEFAULT 0, -- 되돌리기 방지, UPDATE … WHERE engine_list_version=?(이전) 조건부
  change_seq               INTEGER NOT NULL DEFAULT 0, -- 이 계정의 마지막 커서 값
  confirmed_at             TEXT,                       -- 봉투 한 번 풀어 보기 성공 뒤 (그전엔 기록 거절)
  created_at               TEXT NOT NULL
);

CREATE TABLE passkey_credentials (                      -- 로그인 검증용 (패스키 공개키)
  credential_id   TEXT PRIMARY KEY,                     -- b64u
  user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  public_key      BLOB NOT NULL,                        -- COSE
  sign_count      INTEGER NOT NULL DEFAULT 0,
  transports      TEXT,
  aaguid          TEXT,                                 -- 저장 위치 표시용(없으면 NULL, §3.1.9 P9)
  created_at      TEXT NOT NULL,
  last_used_at    TEXT
);
CREATE INDEX idx_cred_user ON passkey_credentials(user_id);

CREATE TABLE key_envelopes (
  envelope_id        TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  method             TEXT NOT NULL CHECK (method IN ('passkey','recovery')),
  credential_id      TEXT REFERENCES passkey_credentials(credential_id) ON DELETE CASCADE,
  wrapped_master_key BLOB NOT NULL,
  kdf_params         TEXT NOT NULL DEFAULT '{"v":1}',
  lookup_hash        TEXT UNIQUE,                       -- 복구 봉투만: hex(SHA-256(lookup_id)) — 찾기 값 원문은 저장 안 함 (규격 §11)
  label              BLOB,                              -- 재잠금 (기기 이름도 정보)
  created_at         TEXT NOT NULL,
  last_used_at       TEXT
);
CREATE INDEX idx_env_user ON key_envelopes(user_id);

CREATE TABLE webauthn_challenges (                      -- /options와 /verify 사이 상태, 5분·1회
  challenge_id        TEXT PRIMARY KEY,
  challenge           TEXT NOT NULL,                    -- b64u
  purpose             TEXT NOT NULL CHECK (purpose IN ('register','login','stepup','recovery')),
  user_id             TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  pairing_session_id  TEXT,
  device_add_session_id TEXT,
  recovery_envelope_id TEXT,                            -- purpose='recovery': 이 복구 봉투로 찾은 user_id에 묶인 5분 등록 도전값
  pending_user_id     TEXT,                             -- 가입 전 user_id (users 줄이 아직 없어 FK 없음, M2a)
  action              TEXT,                             -- purpose='stepup': 묶인 동작 "METHOD /path" (M2a)
  used_at             TEXT,
  created_at          TEXT NOT NULL,
  expires_at          TEXT NOT NULL
);

CREATE TABLE sessions (
  session_id   TEXT PRIMARY KEY,                        -- 쿠키 값의 해시를 저장(원문 저장 안 함)
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE TABLE engines (                                  -- = connectors kind=local (같은 id), INSERT만 (다시 짝 맞추기 = 새 engine_id)
  engine_id    TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  sign_pubkey  BLOB NOT NULL,
  kem_pubkey   BLOB NOT NULL,
  last_req_seq INTEGER NOT NULL DEFAULT 0,               -- 요청 순번 (규격 §2), 만들 때 pairing_sessions.last_req_seq를 옮김
  last_log_seq INTEGER NOT NULL DEFAULT 0,               -- 내용 순번 최댓값 (참고용)
  paused       INTEGER NOT NULL DEFAULT 0,
  pause_reason TEXT,
  hourly_count INTEGER NOT NULL DEFAULT 0,              -- 이상 행동 감지
  hour_bucket  TEXT,
  created_at   TEXT NOT NULL,
  revoked_at   TEXT,
  change_seq   INTEGER NOT NULL
);
CREATE INDEX idx_engines_user ON engines(user_id, change_seq);

CREATE TABLE connectors (
  connector_id TEXT PRIMARY KEY,                        -- kind=local이면 engine_id와 같은 값
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('local','cloud')),
  scopes       TEXT NOT NULL DEFAULT 'record:write',   -- 공개 전환·삭제·공유 범위는 존재하지 않음 (D5)
  created_at   TEXT NOT NULL,
  revoked_at   TEXT
);

CREATE TABLE roots (
  root_id        TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  visibility     TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  public_label   TEXT,
  meta_version   INTEGER NOT NULL DEFAULT 0,            -- 브라우저 합치기 조건부 쓰기
  list_meta      BLOB,                                  -- 재잠금(root_meta), 합친 결과
  crypto_version INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  deleted_at     TEXT,
  change_seq     INTEGER NOT NULL
);
CREATE INDEX idx_roots_user ON roots(user_id, change_seq);

CREATE TABLE records (
  record_id        TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  root_id          TEXT NOT NULL REFERENCES roots(root_id) ON DELETE CASCADE,
  parent_ids       TEXT NOT NULL DEFAULT '-',           -- 쉼표, 정렬, 없으면 '-' (규격 §2)
  commitment       TEXT NOT NULL,                       -- hex
  hash_alg         TEXT NOT NULL DEFAULT 'sha256-nonce-v1',
  manifest         INTEGER NOT NULL DEFAULT 0,
  recorded_at      TEXT NOT NULL,
  engine_id        TEXT NOT NULL REFERENCES engines(engine_id),
  engine_seq       INTEGER NOT NULL,                    -- log_seq
  engine_sig       TEXT NOT NULL,
  list_meta        BLOB NOT NULL,                       -- HPKE 봉인 kind 1
  body_hash        TEXT NOT NULL,                       -- hex SHA-256(record_body 봉인), 서명 대상
  nonce_hash       TEXT NOT NULL,                       -- hex SHA-256(nonce 봉인), 서명 대상
  crypto_version   INTEGER NOT NULL DEFAULT 1,
  deleted_at       TEXT,
  change_seq       INTEGER NOT NULL,
  UNIQUE (engine_id, engine_seq)
);
CREATE INDEX idx_records_user ON records(user_id, change_seq);
CREATE INDEX idx_records_root ON records(root_id);

CREATE TABLE meta_deltas (
  delta_id     TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  root_id      TEXT NOT NULL REFERENCES roots(root_id) ON DELETE CASCADE,
  engine_id    TEXT NOT NULL REFERENCES engines(engine_id),
  seq          INTEGER NOT NULL,                        -- log_seq
  sealed_delta BLOB NOT NULL,                           -- HPKE 봉인 kind 4
  engine_sig   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  merged_at    TEXT,
  mirrored_at  TEXT,
  change_seq   INTEGER NOT NULL,
  UNIQUE (engine_id, seq)
);
CREATE INDEX idx_deltas_root_open ON meta_deltas(root_id) WHERE merged_at IS NULL;
CREATE INDEX idx_deltas_user ON meta_deltas(user_id, change_seq);

CREATE TABLE anchors (
  record_id         TEXT PRIMARY KEY REFERENCES records(record_id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  calendars         TEXT NOT NULL,                      -- JSON [{calendar, pending_b64, submitted_at}]
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed')),
  complete_receipt  TEXT,                               -- b64u, Cron이 받아 옴
  block_height      INTEGER,
  block_time        TEXT,
  confirmed_at      TEXT,
  local_synced_at   TEXT,
  synced_to_repo_at TEXT,
  next_check_at     TEXT,                               -- Cron 확인 간격(점점 늘림)
  change_seq        INTEGER NOT NULL
);
CREATE INDEX idx_anchors_pending ON anchors(next_check_at) WHERE status = 'pending';
CREATE INDEX idx_anchors_user ON anchors(user_id, change_seq);

CREATE TABLE storage_links (
  link_id     TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  engine_id   TEXT NOT NULL REFERENCES engines(engine_id),
  provider    TEXT NOT NULL DEFAULT 'github',
  enc_token   BLOB NOT NULL,                            -- HPKE 봉인 kind 6 {token, repo_full_name, repo_id}
  engine_sig  TEXT NOT NULL,                            -- ideatrail-v1-storagelink 서명 (규격 §8)
  created_at  TEXT NOT NULL,
  revoked_at  TEXT,
  change_seq  INTEGER NOT NULL,
  UNIQUE (engine_id)
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  actor      TEXT NOT NULL,                             -- engine_id 또는 'browser'
  action     TEXT NOT NULL,                             -- record.create, delta.create, visibility.change, engine.revoke …
  target_id  TEXT,
  at         TEXT NOT NULL
);
CREATE INDEX idx_audit_user ON audit_log(user_id, at);

CREATE TABLE public_shares (                            -- 1a는 표만(공유 링크 기능은 v0.2)
  share_id   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  root_id    TEXT,
  record_id  TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE usage_events (                             -- 내용·제목 없음, 90일 뒤 합계만 남기고 삭제
  event_id   TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('signup','connector_linked','dashboard_opened','first_confirmed','bulk_first_done','device_added')),
  at         TEXT NOT NULL
);
CREATE INDEX idx_usage_at ON usage_events(at);

-- §2-11 상태 표 -------------------------------------------------------------

CREATE TABLE pairing_sessions (
  session_id   TEXT PRIMARY KEY,
  engine_id    TEXT NOT NULL UNIQUE,                    -- 엔진이 설치 때 만든 id (engines에 이미 있으면 거절)
  sign_pubkey  BLOB NOT NULL,
  kem_pubkey   BLOB NOT NULL,
  last_req_seq INTEGER NOT NULL DEFAULT 0,               -- engines 줄 생기기 전 요청 순번 (규격 §8)
  user_id      TEXT REFERENCES users(user_id) ON DELETE CASCADE, -- 가입 ① 뒤 채움
  payload      BLOB,                                    -- HPKE kind 8
  payload_mac  TEXT,
  used_at      TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL                            -- +10분 (/deliver까지만)
);

CREATE TABLE device_add_sessions (
  session_id   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  t_pubkey     BLOB,
  join_mac     TEXT,
  join_secret_hash TEXT,                                -- 새 기기에 1회 준 비밀값의 SHA-256 (M2a: d만 알아서는 패스키를 못 붙임)
  sealed_mk    BLOB,                                    -- HPKE kind 9
  key_mac      TEXT,
  used_at      TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL                            -- +2분
);

CREATE TABLE pending_approvals (
  approval_id  TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  engine_id    TEXT NOT NULL REFERENCES engines(engine_id),
  kind         TEXT NOT NULL CHECK (kind IN ('import','add_folder','forget_original','disconnect','signup_select')),
  summary      BLOB NOT NULL,                           -- HPKE kind 10 (signup_select는 kind 11 추천 폴더)
  engine_seq   INTEGER NOT NULL,                        -- appr_seq (log_seq와 별개, 규격 §2)
  engine_sig   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  created_at   TEXT NOT NULL,
  decided_at   TEXT,
  expires_at   TEXT NOT NULL,                           -- +7일
  change_seq   INTEGER NOT NULL
);

CREATE TABLE engine_inbox (
  msg_id       TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  engine_id    TEXT NOT NULL REFERENCES engines(engine_id) ON DELETE CASCADE,
  sealed       BLOB NOT NULL,                           -- HPKE kind 7 (EK)
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_inbox_engine ON engine_inbox(engine_id);

CREATE TABLE repo_heads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  reporter     TEXT NOT NULL,                           -- engine_id 또는 'browser'
  commit_sha   TEXT NOT NULL,
  signature    TEXT,                                    -- 엔진이면 Ed25519, 브라우저면 HMAC(subkey engine_list)
  reported_at  TEXT NOT NULL
);
CREATE INDEX idx_repo_heads_user ON repo_heads(user_id, reported_at);

CREATE TABLE import_allowances (
  user_id      TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  remaining    INTEGER NOT NULL DEFAULT 200,
  expires_at   TEXT NOT NULL
);
