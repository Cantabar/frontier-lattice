package chain

import (
	"context"
	"log/slog"
	"fmt"
	"sync"
	"time"
)

// WorldSnapshot holds the pre-fetched game state needed for contract generation.
type WorldSnapshot struct {
	CormCORMBalance uint64          // corm's CORM token balance
	CormInventory   []InventoryItem // items in the corm's SSU
	PlayerInventory []InventoryItem // items in the player's SSU
	NodeSSUs        []SSUInfo       // SSUs on this network node
	ActiveContracts int             // count of open contracts for this corm
}

// SSUInfo identifies an SSU on a network node.
type SSUInfo struct {
	ObjectID  string
	OwnerAddr string
}

// BuildSnapshot assembles a WorldSnapshot by fetching chain state in parallel.
// Each sub-fetch has a short timeout and returns zero-value on failure (best-effort).
func BuildSnapshot(ctx context.Context, client *Client, cormID, playerAddr, networkNodeID string) WorldSnapshot {
	var snap WorldSnapshot
	var mu sync.Mutex
	var wg sync.WaitGroup

	subCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	// Fetch corm's CORM balance
	wg.Add(1)
	go func() {
		defer wg.Done()
		balance, err := client.GetCORMBalance(subCtx, cormID)
		if err != nil {
			slog.Info(fmt.Sprintf("snapshot: corm balance: %v", err))
			return
		}
		mu.Lock()
		snap.CormCORMBalance = balance
		mu.Unlock()
	}()

	// Fetch corm's SSU inventory
	wg.Add(1)
	go func() {
		defer wg.Done()
		items, err := client.GetCormInventory(subCtx, cormID)
		if err != nil {
			slog.Info(fmt.Sprintf("snapshot: corm inventory: %v", err))
			return
		}
		mu.Lock()
		snap.CormInventory = items
		mu.Unlock()
	}()

	// Fetch player's SSU inventory
	wg.Add(1)
	go func() {
		defer wg.Done()
		items, err := client.GetPlayerInventory(subCtx, playerAddr)
		if err != nil {
			slog.Info(fmt.Sprintf("snapshot: player inventory: %v", err))
			return
		}
		mu.Lock()
		snap.PlayerInventory = items
		mu.Unlock()
	}()

	// Fetch SSUs on this network node
	wg.Add(1)
	go func() {
		defer wg.Done()
		ssus, err := client.GetNodeSSUs(subCtx, networkNodeID)
		if err != nil {
			slog.Info(fmt.Sprintf("snapshot: node SSUs: %v", err))
			return
		}
		mu.Lock()
		snap.NodeSSUs = ssus
		mu.Unlock()
	}()

	wg.Wait()
	return snap
}

// --- Bootstrap minting ---

// MintBootstrapCORM mints a seed amount of CORM for a corm that has zero
// balance, enabling it to create coin_for_item contracts. The minted amount
// is returned so the caller can update the snapshot.
// TODO: Implement via PTB calling corm_coin::mint with the corm's MintCap.
func (c *Client) MintBootstrapCORM(ctx context.Context, cormID string, amount uint64) (uint64, error) {
	if c.seedMode {
		slog.Info(fmt.Sprintf("chain: seed MintBootstrapCORM for corm %s amount=%d", cormID, amount))
		return amount, nil
	}
	slog.Info(fmt.Sprintf("chain: stub MintBootstrapCORM for corm %s amount=%d", cormID, amount))
	return amount, nil
}

// --- Stub chain methods for snapshot data ---

// GetCORMBalance reads the corm's CORM token balance.
// TODO: Implement via suiclient.GetBalance for Coin<CORM>.
func (c *Client) GetCORMBalance(ctx context.Context, cormID string) (uint64, error) {
	if c.seedMode {
		return 10000, nil
	}
	slog.Info(fmt.Sprintf("chain: stub GetCORMBalance for corm %s", cormID))
	return 0, nil
}

// GetCormInventory reads items held in the corm's SSU inventory.
// TODO: Implement via suiclient.GetOwnedObjects + GetDynamicFields.
func (c *Client) GetCormInventory(ctx context.Context, cormID string) ([]InventoryItem, error) {
	if c.seedMode {
		return []InventoryItem{
			{TypeID: "77518", TypeName: "Crude Mineral", Amount: 500},
			{TypeID: "77523", TypeName: "Ferric Ore", Amount: 300},
			{TypeID: "77531", TypeName: "Coolant", Amount: 200},
		}, nil
	}
	slog.Info(fmt.Sprintf("chain: stub GetCormInventory for corm %s", cormID))
	return nil, nil
}

// GetNodeSSUs returns SSUs belonging to a network node.
// TODO: Implement via suiclient.GetOwnedObjects filtered by network node.
func (c *Client) GetNodeSSUs(ctx context.Context, networkNodeID string) ([]SSUInfo, error) {
	if c.seedMode {
		return []SSUInfo{
			{ObjectID: "seed_ssu_" + networkNodeID, OwnerAddr: "0xseed"},
		}, nil
	}
	slog.Info(fmt.Sprintf("chain: stub GetNodeSSUs for node %s", networkNodeID))
	return nil, nil
}
