package tests

import (
	"math/rand"
	"testing"

	"github.com/frontier-corm/corm-brain/internal/chain"
	"github.com/frontier-corm/corm-brain/internal/reasoning"
	"github.com/frontier-corm/corm-brain/internal/types"
)

func seedRNG(seed int64) *rand.Rand {
	return rand.New(rand.NewSource(seed))
}

func testSnapshot() chain.WorldSnapshot {
	return chain.WorldSnapshot{
		CormCORMBalance: 10000,
		CormInventory: []chain.InventoryItem{
			{TypeID: "77518", TypeName: "Crude Mineral", Amount: 500},
			{TypeID: "77523", TypeName: "Ferric Ore", Amount: 300},
			{TypeID: "77531", TypeName: "Coolant", Amount: 200},
		},
		PlayerInventory: []chain.InventoryItem{
			{TypeID: "77525", TypeName: "Refined Crystal", Amount: 150},
			{TypeID: "77518", TypeName: "Crude Mineral", Amount: 800},
			{TypeID: "77540", TypeName: "Fuel Cell", Amount: 50},
		},
		ActiveContracts: 0,
	}
}

func testTraits() *types.CormTraits {
	return &types.CormTraits{
		CormID:    "test-corm-gen",
		Phase:     2,
		Stability: 50,
		Corruption: 20,
		AgendaWeights: types.AgendaWeights{
			Industry: 0.60, Expansion: 0.20, Defense: 0.20,
		},
		Patience:   0.5,
		Paranoia:   0.0,
		Volatility: 0.0,
		PlayerAffinities: map[string]float64{
			"0xplayer1": 0.7,
		},
		ContractTypeAffinity: map[string]float64{
			"coin_for_item":  0.5,
			"item_for_coin":  0.3,
			"item_for_item":  0.1,
			"corm_giveaway":  0.0,
		},
	}
}

func TestGenerateContractIntent_ProducesValidIntent(t *testing.T) {
	traits := testTraits()
	snapshot := testSnapshot()
	rng := seedRNG(42)

	intent, err := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !types.ValidContractTypes[intent.ContractType] {
		t.Errorf("invalid contract type: %s", intent.ContractType)
	}

	if intent.Narrative == "" {
		t.Error("expected non-empty narrative")
	}
}

func TestGenerateContractIntent_EmptyInventoriesAndBalance(t *testing.T) {
	traits := testTraits()
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 0,
		CormInventory:   nil,
		PlayerInventory: nil,
	}
	rng := seedRNG(42)

	_, err := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
	if err == nil {
		t.Error("expected error for empty inventories and zero balance")
	}
}

func TestGenerateContractIntent_CoinForItemNeedsPlayerInventory(t *testing.T) {
	traits := testTraits()
	// Only CORM balance, no player inventory.
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 10000,
		CormInventory:   nil,
		PlayerInventory: nil,
	}

	// With no player inventory and no corm inventory, coin_for_item and item types are infeasible.
	// Only corm_giveaway should be possible.
	rng := seedRNG(42)
	intent, err := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if intent.ContractType != types.ContractCORMGiveaway {
		t.Errorf("expected corm_giveaway when only CORM balance available, got %s", intent.ContractType)
	}
}

func TestGenerateContractIntent_ItemsFromActualInventory(t *testing.T) {
	traits := testTraits()
	snapshot := testSnapshot()

	// Run many iterations to confirm items always come from inventory.
	cormItemNames := map[string]bool{"Crude Mineral": true, "Ferric Ore": true, "Coolant": true}
	playerItemNames := map[string]bool{"Refined Crystal": true, "Crude Mineral": true, "Fuel Cell": true}

	for i := 0; i < 100; i++ {
		rng := seedRNG(int64(i))
		intent, err := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
		if err != nil {
			t.Fatalf("seed %d: unexpected error: %v", i, err)
		}

		if intent.OfferedItem != "" && !cormItemNames[intent.OfferedItem] {
			t.Errorf("seed %d: offered item %q not in corm inventory", i, intent.OfferedItem)
		}
		if intent.WantedItem != "" && !playerItemNames[intent.WantedItem] {
			t.Errorf("seed %d: wanted item %q not in player inventory", i, intent.WantedItem)
		}
	}
}

func TestGenerateContractIntent_HighCorruptionGiveawayChance(t *testing.T) {
	traits := testTraits()
	traits.Corruption = 80
	snapshot := testSnapshot()

	giveawayCount := 0
	iterations := 500
	for i := 0; i < iterations; i++ {
		rng := seedRNG(int64(i))
		intent, err := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
		if err != nil {
			continue
		}
		if intent.ContractType == types.ContractCORMGiveaway {
			giveawayCount++
		}
	}

	// With high corruption, giveaway weight gets +0.3 boost.
	// We expect a meaningful number of giveaways (at least 5%).
	ratio := float64(giveawayCount) / float64(iterations)
	if ratio < 0.03 {
		t.Errorf("expected >3%% giveaways at corruption=80, got %.1f%% (%d/%d)", ratio*100, giveawayCount, iterations)
	}
}

func TestGenerateContractIntent_ParanoiaSuppressesPartialFill(t *testing.T) {
	traits := testTraits()
	snapshot := testSnapshot()

	// Low paranoia → allow partial.
	traits.Paranoia = 0.2
	rng := seedRNG(42)
	intent, err := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !intent.AllowPartial {
		t.Error("expected AllowPartial=true at paranoia=0.2")
	}

	// High paranoia → suppress partial.
	traits.Paranoia = 0.8
	rng = seedRNG(42)
	intent, err = reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if intent.AllowPartial {
		t.Error("expected AllowPartial=false at paranoia=0.8")
	}
}

func TestGenerateContractIntent_TrustScalesCORMAmount(t *testing.T) {
	traits := testTraits()
	snapshot := testSnapshot()

	// High trust player → large.
	traits.PlayerAffinities = map[string]float64{"0xhigh": 0.8}
	rng := seedRNG(42)
	intent, _ := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xhigh", rng)
	if intent.CORMAmount != "large" {
		t.Errorf("expected large CORM amount for high trust, got %s", intent.CORMAmount)
	}

	// Low trust player → small.
	traits.PlayerAffinities = map[string]float64{"0xlow": -0.5}
	rng = seedRNG(42)
	intent, _ = reasoning.GenerateContractIntent(traits, snapshot, nil, "0xlow", rng)
	if intent.CORMAmount != "small" {
		t.Errorf("expected small CORM amount for low trust, got %s", intent.CORMAmount)
	}

	// Neutral player → medium.
	rng = seedRNG(42)
	intent, _ = reasoning.GenerateContractIntent(traits, snapshot, nil, "0xunknown", rng)
	if intent.CORMAmount != "medium" {
		t.Errorf("expected medium CORM amount for unknown player, got %s", intent.CORMAmount)
	}
}

func TestGenerateContractIntent_UrgencyFromPatience(t *testing.T) {
	traits := testTraits()
	snapshot := testSnapshot()

	tests := []struct {
		patience float64
		expected string
	}{
		{0.9, "low"},
		{0.5, "medium"},
		{0.1, "high"},
	}

	for _, tt := range tests {
		traits.Patience = tt.patience
		rng := seedRNG(42)
		intent, err := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
		if err != nil {
			t.Fatalf("patience=%.1f: unexpected error: %v", tt.patience, err)
		}
		if intent.Urgency != tt.expected {
			t.Errorf("patience=%.1f: expected urgency=%s, got %s", tt.patience, tt.expected, intent.Urgency)
		}
	}
}

func TestGenerateContractIntent_SeededReproducibility(t *testing.T) {
	traits := testTraits()
	snapshot := testSnapshot()

	// Same seed should produce identical results.
	rng1 := seedRNG(999)
	intent1, err1 := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng1)

	rng2 := seedRNG(999)
	intent2, err2 := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng2)

	if err1 != nil || err2 != nil {
		t.Fatalf("unexpected errors: %v, %v", err1, err2)
	}

	if intent1.ContractType != intent2.ContractType {
		t.Errorf("type mismatch: %s vs %s", intent1.ContractType, intent2.ContractType)
	}
	if intent1.OfferedItem != intent2.OfferedItem {
		t.Errorf("offered mismatch: %s vs %s", intent1.OfferedItem, intent2.OfferedItem)
	}
	if intent1.WantedItem != intent2.WantedItem {
		t.Errorf("wanted mismatch: %s vs %s", intent1.WantedItem, intent2.WantedItem)
	}
	if intent1.CORMAmount != intent2.CORMAmount {
		t.Errorf("CORM amount mismatch: %s vs %s", intent1.CORMAmount, intent2.CORMAmount)
	}
	if intent1.Quantity != intent2.Quantity {
		t.Errorf("quantity mismatch: %s vs %s", intent1.Quantity, intent2.Quantity)
	}
	if intent1.Urgency != intent2.Urgency {
		t.Errorf("urgency mismatch: %s vs %s", intent1.Urgency, intent2.Urgency)
	}
}

func TestGenerateContractIntent_QuantityFromStability(t *testing.T) {
	traits := testTraits()
	snapshot := testSnapshot()

	// High stability → large.
	traits.Stability = 80
	traits.Corruption = 10
	rng := seedRNG(42)
	intent, _ := reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
	if intent.Quantity != "large" {
		t.Errorf("expected large quantity at stability=80, got %s", intent.Quantity)
	}

	// Low stability → small.
	traits.Stability = 20
	rng = seedRNG(42)
	intent, _ = reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
	if intent.Quantity != "small" {
		t.Errorf("expected small quantity at stability=20, got %s", intent.Quantity)
	}

	// Mid stability → medium.
	traits.Stability = 50
	rng = seedRNG(42)
	intent, _ = reasoning.GenerateContractIntent(traits, snapshot, nil, "0xplayer1", rng)
	if intent.Quantity != "medium" {
		t.Errorf("expected medium quantity at stability=50, got %s", intent.Quantity)
	}
}
