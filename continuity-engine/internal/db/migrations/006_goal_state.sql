-- 006_goal_state.sql — persist goal lifecycle state (phase, distributed materials, completed goals)
ALTER TABLE corm_traits ADD COLUMN IF NOT EXISTS goal_state JSONB DEFAULT '{}';
