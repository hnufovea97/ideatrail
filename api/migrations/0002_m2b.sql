-- M2b (2026-11-17, ECC 보안 검토): 엔진 하루 상한, 승인 순번 중복 방지, sync용 색인
ALTER TABLE engines ADD COLUMN day_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engines ADD COLUMN day_bucket TEXT;
CREATE UNIQUE INDEX uq_approvals_engine_seq ON pending_approvals(engine_id, engine_seq);
CREATE INDEX idx_approvals_user ON pending_approvals(user_id, change_seq);
CREATE INDEX idx_storage_user ON storage_links(user_id, change_seq);
