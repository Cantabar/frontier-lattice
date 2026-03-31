package chain

import (
	"context"
)

// InventoryItem represents an item in a player's SSU inventory.
type InventoryItem struct {
	TypeID   string
	TypeName string
	Amount   uint64
}

// GetPlayerInventory reads a player's SSU inventory items and balances.
// Currently returns seed data or nil — full implementation requires
// indexer integration for SSU inventory reads.
func (c *Client) GetPlayerInventory(ctx context.Context, playerAddress string) ([]InventoryItem, error) {
	if c.seedMode {
		return []InventoryItem{
			{TypeID: "77525", TypeName: "Refined Crystal", Amount: 150},
			{TypeID: "77518", TypeName: "Crude Mineral", Amount: 800},
			{TypeID: "77540", TypeName: "Fuel Cell", Amount: 50},
		}, nil
	}
	// TODO: Query indexer for player SSU inventory
	return nil, nil
}
