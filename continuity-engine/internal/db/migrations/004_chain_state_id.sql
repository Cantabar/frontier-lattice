-- 004_chain_state_id.sql — store on-chain CormState object ID per network node
-- Each network node maps 1:1 to an on-chain CormState shared object.
-- The chain_state_id is the Sui hex object ID returned by corm_state::install.
ALTER TABLE corm_network_nodes
  ADD COLUMN IF NOT EXISTS chain_state_id TEXT;
