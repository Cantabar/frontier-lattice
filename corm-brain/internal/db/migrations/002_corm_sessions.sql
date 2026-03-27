-- 002_corm_sessions.sql — session → corm mapping
-- Each session is assigned a unique corm_id on first contact.
-- Network node linking happens separately and is optional.
CREATE TABLE IF NOT EXISTS corm_sessions (
  environment TEXT NOT NULL DEFAULT 'default',
  session_id  TEXT NOT NULL,
  corm_id     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (environment, session_id)
);
CREATE INDEX IF NOT EXISTS idx_corm_sessions_corm ON corm_sessions (environment, corm_id);
