package chain

import (
	"context"
	"fmt"
	"log/slog"
)

// CormStateOnChain represents the on-chain CormState object fields.
type CormStateOnChain struct {
	ObjectID      string
	NetworkNodeID string
	Phase         int
	Stability     int
	Corruption    int
}

// CreateCormState provisions a new CormState shared object on-chain.
// Returns the new object ID (corm_id) and MintCap.
// TODO: Implement via PTB calling corm_state::create(network_node_id).
func (c *Client) CreateCormState(ctx context.Context, networkNodeID string) (string, error) {
	if networkNodeID == "" {
		return "", fmt.Errorf("network_node_id is required")
	}
	if !c.HasSigner() {
		return "", fmt.Errorf("no signer configured")
	}

	// Stub: generate a placeholder corm_id
	// Real implementation: build PTB, sign, submit, extract created object ID
	prefix := networkNodeID
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}
	cormID := fmt.Sprintf("corm_%s", prefix)
	slog.Info(fmt.Sprintf("chain: stub CreateCormState for node %s → %s", networkNodeID, cormID))
	return cormID, nil
}

// GetCormState reads a CormState shared object from chain via RPC.
// TODO: Implement via suiclient.GetObject + BCS decode.
func (c *Client) GetCormState(ctx context.Context, cormID string) (*CormStateOnChain, error) {
	// Stub: return nil (not found) — real impl reads from SUI RPC
	slog.Info(fmt.Sprintf("chain: stub GetCormState for %s", cormID))
	return nil, nil
}

// UpdateCormState updates phase/stability/corruption on-chain.
// TODO: Implement via PTB calling corm_state::update_state.
func (c *Client) UpdateCormState(ctx context.Context, cormID string, phase int, stability, corruption float64) error {
	if !c.HasSigner() {
		return fmt.Errorf("no signer configured")
	}

	slog.Info(fmt.Sprintf("chain: stub UpdateCormState %s → phase=%d stab=%.0f corr=%.0f", cormID, phase, stability, corruption))
	return nil
}
