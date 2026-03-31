package reasoning

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

// testRegistry builds a minimal item registry for resolver tests.
// It writes temp types.json + groups.json files to a temp dir.
func testRegistry(t *testing.T) *chain.Registry {
	t.Helper()
	typesJSON := `{
		"77800": {"typeID": 77800, "typeName": "Feldspar Crystals", "groupID": 1, "volume": 1.0, "published": 1},
		"89259": {"typeID": 89259, "typeName": "Silica Grains", "groupID": 1, "volume": 1.0, "published": 1},
		"77518": {"typeID": 77518, "typeName": "Crude Mineral", "groupID": 1, "volume": 1.0, "published": 1}
	}`
	groupsJSON := `{"1": {"groupName": "Ore"}}`

	dir := t.TempDir()
	writeFile(t, dir, "types.json", typesJSON)
	writeFile(t, dir, "groups.json", groupsJSON)

	return chain.NewRegistry(dir, "")
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
		t.Fatalf("writeFile %s: %v", name, err)
	}
}

func TestResolveIntent_ExactQuantityUsed(t *testing.T) {
	registry := testRegistry(t)
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 10000,
		NodeSSUs: []chain.SSUInfo{
			{ObjectID: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"},
		},
		PlayerInventory: []chain.InventoryItem{
			{TypeID: "77800", TypeName: "Feldspar Crystals", Amount: 500},
		},
	}
	traits := &types.CormTraits{Patience: 0.5}
	pricing := PricingConfig{CORMPerLUX: 1.0, CORMFloorPerUnit: 10}
	player := PlayerIdentity{Address: "0xplayer", CharacterID: "0xchar"}

	// ExactQuantity = 200 should be used directly, not resolveQuantity.
	intent := types.ContractIntent{
		ContractType:  types.ContractCoinForItem,
		WantedItem:    "Feldspar Crystals",
		CORMAmount:    "medium",
		ExactQuantity: 200,
		Urgency:       "medium",
		AllowPartial:  true,
	}

	params, err := ResolveIntent(intent, snapshot, registry, traits, pricing, player)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if params.WantedQuantity != 200 {
		t.Errorf("expected WantedQuantity=200 (from ExactQuantity), got %d", params.WantedQuantity)
	}
}

func TestResolveIntent_QualitativeFallback(t *testing.T) {
	registry := testRegistry(t)
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 10000,
		NodeSSUs: []chain.SSUInfo{
			{ObjectID: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"},
		},
		PlayerInventory: []chain.InventoryItem{
			{TypeID: "77800", TypeName: "Feldspar Crystals", Amount: 500},
		},
	}
	traits := &types.CormTraits{Patience: 0.5}
	pricing := PricingConfig{CORMPerLUX: 1.0, CORMFloorPerUnit: 10}
	player := PlayerIdentity{Address: "0xplayer", CharacterID: "0xchar"}

	// ExactQuantity = 0 → should fall back to resolveQuantity("medium", 500) = 200.
	intent := types.ContractIntent{
		ContractType: types.ContractCoinForItem,
		WantedItem:   "Feldspar Crystals",
		CORMAmount:   "medium",
		Quantity:     "medium",
		Urgency:      "medium",
		AllowPartial: true,
	}

	params, err := ResolveIntent(intent, snapshot, registry, traits, pricing, player)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// medium = 40% of 500 = 200
	if params.WantedQuantity != 200 {
		t.Errorf("expected WantedQuantity=200 (40%% of 500), got %d", params.WantedQuantity)
	}
}

func TestResolveIntent_ExactQuantityItemForCoin(t *testing.T) {
	registry := testRegistry(t)
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 10000,
		NodeSSUs: []chain.SSUInfo{
			{ObjectID: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"},
		},
		CormInventory: []chain.InventoryItem{
			{TypeID: "77518", TypeName: "Crude Mineral", Amount: 300},
		},
	}
	traits := &types.CormTraits{Patience: 0.5}
	pricing := PricingConfig{CORMPerLUX: 1.0, CORMFloorPerUnit: 10}
	player := PlayerIdentity{Address: "0xplayer", CharacterID: "0xchar"}

	intent := types.ContractIntent{
		ContractType:  types.ContractItemForCoin,
		OfferedItem:   "Crude Mineral",
		CORMAmount:    "medium",
		ExactQuantity: 150,
		Urgency:       "medium",
	}

	params, err := ResolveIntent(intent, snapshot, registry, traits, pricing, player)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if params.OfferedQuantity != 150 {
		t.Errorf("expected OfferedQuantity=150 (from ExactQuantity), got %d", params.OfferedQuantity)
	}
}

func TestResolveIntent_ExactQuantityItemForItem(t *testing.T) {
	registry := testRegistry(t)
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 10000,
		NodeSSUs: []chain.SSUInfo{
			{ObjectID: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"},
		},
		CormInventory: []chain.InventoryItem{
			{TypeID: "77518", TypeName: "Crude Mineral", Amount: 300},
		},
		PlayerInventory: []chain.InventoryItem{
			{TypeID: "89259", TypeName: "Silica Grains", Amount: 200},
		},
	}
	traits := &types.CormTraits{Patience: 0.5}
	pricing := PricingConfig{CORMPerLUX: 1.0, CORMFloorPerUnit: 10}
	player := PlayerIdentity{Address: "0xplayer", CharacterID: "0xchar"}

	intent := types.ContractIntent{
		ContractType:  types.ContractItemForItem,
		OfferedItem:   "Crude Mineral",
		WantedItem:    "Silica Grains",
		ExactQuantity: 75,
		Urgency:       "medium",
	}

	params, err := ResolveIntent(intent, snapshot, registry, traits, pricing, player)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if params.OfferedQuantity != 75 {
		t.Errorf("expected OfferedQuantity=75 (from ExactQuantity), got %d", params.OfferedQuantity)
	}
}

func TestValidateParams_ZeroBalanceCanMintInline(t *testing.T) {
	registry := testRegistry(t)
	params := &chain.ContractParams{
		ContractType:    types.ContractCoinForItem,
		CORMEscrowAmount: 500,
		WantedTypeID:    77800,
		WantedQuantity:  10,
		DeadlineMs:      9999999999999,
	}
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 0,
		CanMintInline:   true,
		ActiveContracts: 0,
	}

	if err := ValidateParams(params, snapshot, registry); err != nil {
		t.Errorf("expected no error with CanMintInline=true and zero balance, got: %v", err)
	}
	// Escrow should remain at the original computed amount (not clamped to 0).
	if params.CORMEscrowAmount != 500 {
		t.Errorf("expected escrow=500 (unclamped), got %d", params.CORMEscrowAmount)
	}
}

func TestValidateParams_ZeroBalanceNoMintInline(t *testing.T) {
	registry := testRegistry(t)
	params := &chain.ContractParams{
		ContractType:    types.ContractCoinForItem,
		CORMEscrowAmount: 500,
		WantedTypeID:    77800,
		WantedQuantity:  10,
		DeadlineMs:      9999999999999,
	}
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 0,
		CanMintInline:   false,
		ActiveContracts: 0,
	}

	err := ValidateParams(params, snapshot, registry)
	if err == nil {
		t.Error("expected error with CanMintInline=false and zero balance")
	}
}

// Ensure the error message for unknown items hasn't regressed.
func TestResolveIntent_UnknownItem(t *testing.T) {
	registry := testRegistry(t)
	snapshot := chain.WorldSnapshot{
		NodeSSUs: []chain.SSUInfo{
			{ObjectID: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"},
		},
	}
	traits := &types.CormTraits{}
	pricing := PricingConfig{}
	player := PlayerIdentity{}

	intent := types.ContractIntent{
		ContractType: types.ContractCoinForItem,
		WantedItem:   "Nonexistent Ore",
		Quantity:     "medium",
		Urgency:      "medium",
	}

	_, err := ResolveIntent(intent, snapshot, registry, traits, pricing, player)
	if err == nil || !strings.Contains(err.Error(), "unknown item") {
		t.Errorf("expected 'unknown item' error, got: %v", err)
	}
}
