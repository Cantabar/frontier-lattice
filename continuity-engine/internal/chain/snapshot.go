package chain

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/pattonkan/sui-go/sui"
	"github.com/pattonkan/sui-go/suiclient"
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
// balance, enabling it to create coin_for_item contracts. Mints to the
// brain's own address. The minted amount is returned so the caller can
// update the snapshot.
func (c *Client) MintBootstrapCORM(ctx context.Context, cormID string, amount uint64) (uint64, error) {
	if c.seedMode {
		slog.Info(fmt.Sprintf("chain: seed MintBootstrapCORM for corm %s amount=%d", cormID, amount))
		return amount, nil
	}
	if !c.HasSigner() || c.cormStatePkg == nil || c.coinAuthorityObjID == nil {
		slog.Info(fmt.Sprintf("chain: stub MintBootstrapCORM for corm %s amount=%d (missing config)", cormID, amount))
		return amount, nil
	}

	// Mint to the brain's own address so it can use CORM for escrow
	err := c.MintCORM(ctx, cormID, c.signer.AddressString(), amount)
	if err != nil {
		return 0, fmt.Errorf("bootstrap mint: %w", err)
	}

	slog.Info(fmt.Sprintf("chain: MintBootstrapCORM for corm %s amount=%d", cormID, amount))
	return amount, nil
}

// --- Chain read methods for snapshot data ---

// GetCORMBalance reads the brain's CORM token balance from chain.
// This is the total CORM held by the brain's signer address.
func (c *Client) GetCORMBalance(ctx context.Context, cormID string) (uint64, error) {
	if c.seedMode {
		return 10000, nil
	}
	if !c.HasSigner() || c.cormStatePkg == nil {
		return 0, nil
	}

	coinType := sui.ObjectType(c.CORMCoinType())
	resp, err := c.rpc.GetBalance(ctx, &suiclient.GetBalanceRequest{
		Owner:    c.signer.Address(),
		CoinType: coinType,
	})
	if err != nil {
		return 0, fmt.Errorf("get CORM balance: %w", err)
	}

	return resp.TotalBalance.Uint64(), nil
}

// GetCormInventory reads items held in the corm's SSU inventory.
// Currently returns seed data or nil — full implementation requires
// indexer integration for SSU inventory reads.
func (c *Client) GetCormInventory(ctx context.Context, cormID string) ([]InventoryItem, error) {
	if c.seedMode {
		return []InventoryItem{
			{TypeID: "77518", TypeName: "Crude Mineral", Amount: 500},
			{TypeID: "77523", TypeName: "Ferric Ore", Amount: 300},
			{TypeID: "77531", TypeName: "Coolant", Amount: 200},
		}, nil
	}
	// TODO: Query indexer or SSU dynamic fields for corm inventory
	return nil, nil
}

// GetNodeSSUs returns SSUs belonging to a network node.
// Currently returns seed data or nil — full implementation requires
// indexer integration for network node → SSU mapping.
func (c *Client) GetNodeSSUs(ctx context.Context, networkNodeID string) ([]SSUInfo, error) {
	if c.seedMode {
		return []SSUInfo{
			{ObjectID: "seed_ssu_" + networkNodeID, OwnerAddr: "0xseed"},
		}, nil
	}
	// TODO: Query indexer for SSUs on this network node
	return nil, nil
}
