-- 005_corm_players.sql — player address → corm mapping
-- Allows corm identity resolution when session cookie is lost and no
-- network node ID is provided.  Upserted on first association; the most
-- recent corm wins when a player changes corms.
CREATE TABLE IF NOT EXISTS corm_players (
  environment    TEXT NOT NULL DEFAULT 'default',
  player_address TEXT NOT NULL,
  corm_id        TEXT NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (environment, player_address)
);
CREATE INDEX IF NOT EXISTS idx_corm_players_corm ON corm_players (environment, corm_id);
