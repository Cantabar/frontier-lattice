package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/pattonkan/sui-go/sui"
	"github.com/pattonkan/sui-go/suiclient"
)

// WorldSnapshot holds the pre-fetched game state needed for contract generation.
type WorldSnapshot struct {
	CormCORMBalance uint64          // corm's CORM token balance
	CanMintInline   bool            // true if the chain client can mint CORM inline within a PTB
	CormInventory   []InventoryItem // items in the corm's SSU
	PlayerInventory []InventoryItem // items in the player's SSU
	NodeSSUs        []SSUInfo       // SSUs on this network node
	NodeAssemblies  []AssemblyInfo  // manufacturing facilities on this network node
	ActiveContracts int             // count of open contracts for this corm
	Degraded        bool            // true if any Phase 1 RPC call failed; data may be incomplete
}

// SSUInfo identifies an SSU on a network node.
type SSUInfo struct {
	ObjectID  string
	OwnerAddr string
}

// AssemblyInfo identifies a manufacturing facility on a network node.
type AssemblyInfo struct {
	ObjectID string
	TypeID   uint64
	TypeName string
}

// BuildSnapshot assembles a WorldSnapshot by fetching chain state in two phases.
//
// Phase 1 (parallel): CORM balance, NodeSSUs, NodeAssemblies.
// Phase 2 (parallel): CormInventory (self-contained via OwnerCap enumeration),
// PlayerInventory (uses NodeSSUs from Phase 1 to locate the player's SSU).
//
// Each sub-fetch operates under a short timeout and returns a zero value on
// failure (best-effort graceful degradation).
func BuildSnapshot(ctx context.Context, client *Client, cormID, playerAddr, networkNodeID string) WorldSnapshot {
	var snap WorldSnapshot
	snap.CanMintInline = client.CanMintInline()
	var mu sync.Mutex
	var wg sync.WaitGroup

	subCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	// --- Phase 1: CORM balance, NodeSSUs, NodeAssemblies ---

	// Fetch corm's CORM balance
	wg.Add(1)
	go func() {
		defer wg.Done()
		balance, err := client.GetCORMBalance(subCtx, cormID)
		if err != nil {
			slog.Info(fmt.Sprintf("snapshot: corm balance: %v", err))
			mu.Lock()
			snap.Degraded = true
			mu.Unlock()
			return
		}
		mu.Lock()
		snap.CormCORMBalance = balance
		mu.Unlock()
	}()

	// Fetch SSUs on this network node
	wg.Add(1)
	go func() {
		defer wg.Done()
		ssus, err := client.GetNodeSSUs(subCtx, networkNodeID)
		if err != nil {
			slog.Info(fmt.Sprintf("snapshot: node SSUs: %v", err))
			mu.Lock()
			snap.Degraded = true
			mu.Unlock()
			return
		}
		mu.Lock()
		snap.NodeSSUs = ssus
		mu.Unlock()
	}()

	// Fetch manufacturing facilities on this network node
	wg.Add(1)
	go func() {
		defer wg.Done()
		assemblies, err := client.GetNodeAssemblies(subCtx, networkNodeID)
		if err != nil {
			slog.Info(fmt.Sprintf("snapshot: node assemblies: %v", err))
			mu.Lock()
			snap.Degraded = true
			mu.Unlock()
			return
		}
		mu.Lock()
		snap.NodeAssemblies = assemblies
		mu.Unlock()
	}()

	wg.Wait()

	// --- Phase 2: inventories (depend on NodeSSUs from Phase 1) ---

	// Fetch corm's SSU inventory (resolves SSUs via brain's OwnerCaps)
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

	// Fetch player's SSU inventory (uses NodeSSUs to find the player's SSU)
	wg.Add(1)
	go func() {
		defer wg.Done()
		items, err := client.GetPlayerInventory(subCtx, playerAddr, snap.NodeSSUs)
		if err != nil {
			slog.Info(fmt.Sprintf("snapshot: player inventory: %v", err))
			return
		}
		mu.Lock()
		snap.PlayerInventory = items
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
		slog.Warn(fmt.Sprintf("chain: MintBootstrapCORM skipped for corm %s amount=%d (missing config: signer=%t pkg=%t authority=%t)",
			cormID, amount, c.HasSigner(), c.cormStatePkg != nil, c.coinAuthorityObjID != nil))
		return 0, nil
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

// GetNodeSSUs
// Reads the on-chain network node object to discover connected assemblies,
// then filters for StorageUnit types. Falls back to seed data or nil.
func (c *Client) GetNodeSSUs(ctx context.Context, networkNodeID string) ([]SSUInfo, error) {
	if c.seedMode {
		// Use a valid-looking 64-hex-char Sui object ID so the real contract
		// path can parse it with ObjectIdFromHex.
		seedSSU := "0x00000000000000000000000000000000000000000000000000005eed55000001"
		return []SSUInfo{
			{ObjectID: seedSSU, OwnerAddr: "0x00000000000000000000000000000000000000000000000000005eed00000001"},
		}, nil
	}

	objects, err := c.getConnectedAssemblyObjects(ctx, networkNodeID)
	if err != nil {
		slog.Warn(fmt.Sprintf("snapshot: GetNodeSSUs RPC failed for node %s: %v", networkNodeID, err))
		return nil, fmt.Errorf("get node SSUs: %w", err)
	}

	var ssus []SSUInfo
	for _, obj := range objects {
		if obj.Data == nil || obj.Data.Content == nil || obj.Data.Content.Data.MoveObject == nil {
			continue
		}
		objType := obj.Data.Content.Data.MoveObject.Type
		if !strings.Contains(objType, "storage_unit::StorageUnit") {
			continue
		}
		objID := obj.Data.ObjectId.String()

		// Extract owner address from the object's Owner field if available.
		ownerAddr := ""
		if obj.Data.Owner != nil {
			if obj.Data.Owner.AddressOwner != nil {
				ownerAddr = obj.Data.Owner.AddressOwner.String()
			}
		}

		ssus = append(ssus, SSUInfo{ObjectID: objID, OwnerAddr: ownerAddr})
	}

	slog.Info(fmt.Sprintf("snapshot: GetNodeSSUs for node %s → %d SSUs from %d connected assemblies", networkNodeID, len(ssus), len(objects)))
	return ssus, nil
}

// GetNodeAssemblies returns manufacturing facilities on a network node.
// Reads the on-chain network node object to discover connected assemblies,
// then extracts type_id fields. Falls back to seed data or nil.
func (c *Client) GetNodeAssemblies(ctx context.Context, networkNodeID string) ([]AssemblyInfo, error) {
	if c.seedMode {
		return []AssemblyInfo{
			{ObjectID: "seed_refinery_" + networkNodeID, TypeID: FacilityFieldRefinery, TypeName: "Field Refinery"},
			{ObjectID: "seed_printer_" + networkNodeID, TypeID: FacilityFieldPrinter, TypeName: "Field Printer"},
			{ObjectID: "seed_miniprinter_" + networkNodeID, TypeID: FacilityMiniPrinter, TypeName: "Mini Printer"},
			{ObjectID: "seed_miniberth_" + networkNodeID, TypeID: FacilityMiniBerth, TypeName: "Mini Berth"},
		}, nil
	}

	objects, err := c.getConnectedAssemblyObjects(ctx, networkNodeID)
	if err != nil {
		slog.Warn(fmt.Sprintf("snapshot: GetNodeAssemblies RPC failed for node %s: %v", networkNodeID, err))
		return nil, fmt.Errorf("get node assemblies: %w", err)
	}

	var assemblies []AssemblyInfo
	for _, obj := range objects {
		if obj.Data == nil || obj.Data.Content == nil || obj.Data.Content.Data.MoveObject == nil {
			continue
		}

		var fields map[string]interface{}
		if err := json.Unmarshal(obj.Data.Content.Data.MoveObject.Fields, &fields); err != nil {
			continue
		}

		typeID := uint64(toInt(fields["type_id"]))
		if typeID == 0 {
			continue
		}

		objID := obj.Data.ObjectId.String()
		typeName := facilityIDToName(typeID)

		assemblies = append(assemblies, AssemblyInfo{
			ObjectID: objID,
			TypeID:   typeID,
			TypeName: typeName,
		})
	}

	slog.Info(fmt.Sprintf("snapshot: GetNodeAssemblies for node %s → %d assemblies from %d connected", networkNodeID, len(assemblies), len(objects)))
	return assemblies, nil
}

// --- Network node assembly discovery helpers ---

// getConnectedAssemblyObjects reads a network node's connected_assembly_ids
// from chain, then batch-fetches those objects. Returns nil if the node has
// no connected assemblies or if the RPC is unavailable.
func (c *Client) getConnectedAssemblyObjects(ctx context.Context, networkNodeID string) ([]suiclient.SuiObjectResponse, error) {
	if networkNodeID == "" {
		return nil, nil
	}

	nodeObjID, err := sui.ObjectIdFromHex(networkNodeID)
	if err != nil {
		return nil, fmt.Errorf("invalid network node ID: %w", err)
	}

	// Read the network node object to get connected_assembly_ids.
	nodeResp, err := c.rpc.GetObject(ctx, &suiclient.GetObjectRequest{
		ObjectId: nodeObjID,
		Options: &suiclient.SuiObjectDataOptions{
			ShowContent: true,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get network node object: %w", err)
	}
	if nodeResp.Data == nil || nodeResp.Data.Content == nil || nodeResp.Data.Content.Data.MoveObject == nil {
		return nil, nil
	}

	var nodeFields map[string]interface{}
	if err := json.Unmarshal(nodeResp.Data.Content.Data.MoveObject.Fields, &nodeFields); err != nil {
		return nil, fmt.Errorf("parse network node fields: %w", err)
	}

	assemblyIDs := parseConnectedAssemblyIDs(nodeFields)
	if len(assemblyIDs) == 0 {
		return nil, nil
	}

	// Batch-fetch all connected assembly objects.
	objIDs := make([]*sui.ObjectId, 0, len(assemblyIDs))
	for _, idStr := range assemblyIDs {
		oid, err := sui.ObjectIdFromHex(idStr)
		if err != nil {
			slog.Debug(fmt.Sprintf("snapshot: skip invalid assembly ID %q: %v", idStr, err))
			continue
		}
		objIDs = append(objIDs, oid)
	}
	if len(objIDs) == 0 {
		return nil, nil
	}

	resp, err := c.rpc.MultiGetObjects(ctx, &suiclient.MultiGetObjectsRequest{
		ObjectIds: objIDs,
		Options: &suiclient.SuiObjectDataOptions{
			ShowType:    true,
			ShowContent: true,
			ShowOwner:   true,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("multi-get assembly objects: %w", err)
	}

	return resp, nil
}

// parseConnectedAssemblyIDs extracts the connected_assembly_ids array from
// a network node's parsed content fields. The on-chain field is a vector of
// Sui object IDs.
func parseConnectedAssemblyIDs(fields map[string]interface{}) []string {
	raw, ok := fields["connected_assembly_ids"]
	if !ok {
		return nil
	}

	arr, ok := raw.([]interface{})
	if !ok {
		return nil
	}

	result := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok && s != "" {
			result = append(result, s)
		}
	}
	return result
}

// facilityIDToName returns the human-readable name for a facility type ID.
func facilityIDToName(typeID uint64) string {
	for name, id := range facilityNameToID {
		if id == typeID {
			return name
		}
	}
	return fmt.Sprintf("Assembly %d", typeID)
}
