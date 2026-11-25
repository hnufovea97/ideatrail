-- M6: 'update' approval kind (engine asks to approve a new engine version). SQLite cannot alter a CHECK, so rebuild the table.
-- Nothing references pending_approvals, so the drop is safe with foreign keys on.
CREATE TABLE pending_approvals_new (
  approval_id  TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  engine_id    TEXT NOT NULL REFERENCES engines(engine_id),
  kind         TEXT NOT NULL CHECK (kind IN ('import','add_folder','forget_original','disconnect','signup_select','update')),
  summary      BLOB NOT NULL,
  engine_seq   INTEGER NOT NULL,
  engine_sig   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  created_at   TEXT NOT NULL,
  decided_at   TEXT,
  expires_at   TEXT NOT NULL,
  change_seq   INTEGER NOT NULL
);
INSERT INTO pending_approvals_new (approval_id, user_id, engine_id, kind, summary, engine_seq, engine_sig, status, created_at, decided_at, expires_at, change_seq)
  SELECT approval_id, user_id, engine_id, kind, summary, engine_seq, engine_sig, status, created_at, decided_at, expires_at, change_seq FROM pending_approvals;
DROP TABLE pending_approvals;
ALTER TABLE pending_approvals_new RENAME TO pending_approvals;
CREATE UNIQUE INDEX uq_approvals_engine_seq ON pending_approvals(engine_id, engine_seq);
CREATE INDEX idx_approvals_user ON pending_approvals(user_id, change_seq);
