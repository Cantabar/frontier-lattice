package reasoning

import (
	"strings"
	"testing"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

func TestPlanAcquisitionContracts_EmptyInventory(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goals := DefaultGoals()
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 1000,
		CormInventory:   nil,
		PlayerInventory: nil,
	}
	traits := &types.CormTraits{
		PlayerAffinities: map[string]float64{"0xplayer": 0.3},
	}

	intents := PlanAcquisitionContracts(goals, snapshot, recipes, traits, "0xplayer", 5)
	if len(intents) == 0 {
		t.Fatal("expected at least one acquisition intent")
	}

	// All should be coin_for_item.
	for i, intent := range intents {
		if intent.ContractType != types.ContractCoinForItem {
			t.Errorf("intent[%d]: expected coin_for_item, got %s", i, intent.ContractType)
		}
		if intent.WantedItem == "" {
			t.Errorf("intent[%d]: missing wanted item name", i)
		}
		if intent.Narrative == "" {
			t.Errorf("intent[%d]: missing narrative", i)
		}
	}

	// First intent should be for the highest-priority raw material (Feldspar Crystals).
	if intents[0].WantedItem != "Feldspar Crystals" {
		t.Errorf("expected first intent for Feldspar Crystals, got %s", intents[0].WantedItem)
	}
}

func TestPlanAcquisitionContracts_PartialInventory(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goals := []CormGoal{{TargetTypeID: 87847, TargetName: "Reflex", Priority: 0}}

	// Corm already has plenty of Feldspar Crystals' downstream product.
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 1000,
		CormInventory: []chain.InventoryItem{
			{TypeID: "77800", TypeName: "Feldspar Crystals", Amount: 999999},
		},
	}
	traits := &types.CormTraits{
		PlayerAffinities: map[string]float64{},
	}

	intents := PlanAcquisitionContracts(goals, snapshot, recipes, traits, "0xplayer", 5)

	// Feldspar Crystals should NOT appear — we have plenty.
	for _, intent := range intents {
		if intent.WantedItem == "Feldspar Crystals" {
			t.Error("should not request Feldspar Crystals when corm has plenty")
		}
	}
}

func TestPlanAcquisitionContracts_RespectsSlotsLimit(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goals := DefaultGoals()
	snapshot := chain.WorldSnapshot{CormCORMBalance: 1000}
	traits := &types.CormTraits{PlayerAffinities: map[string]float64{}}

	intents := PlanAcquisitionContracts(goals, snapshot, recipes, traits, "0xplayer", 2)
	if len(intents) > 2 {
		t.Errorf("expected at most 2 intents, got %d", len(intents))
	}
}

func TestPlanAcquisitionContracts_NilRecipes(t *testing.T) {
	intents := PlanAcquisitionContracts(DefaultGoals(), chain.WorldSnapshot{}, nil, nil, "", 5)
	if intents != nil {
		t.Error("expected nil intents when recipes is nil")
	}
}

func TestPlanAcquisitionContracts_NarrativeReferencesGoal(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goals := DefaultGoals()
	snapshot := chain.WorldSnapshot{CormCORMBalance: 1000}

	intents := PlanAcquisitionContracts(goals, snapshot, recipes, nil, "", 1)
	if len(intents) == 0 {
		t.Fatal("expected at least one intent")
	}
	if !strings.Contains(intents[0].Narrative, "Reflex") {
		t.Errorf("narrative should reference Reflex goal, got: %s", intents[0].Narrative)
	}
}

func TestEmptyStateMessage_LowCorruption(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goals := DefaultGoals()

	msg := EmptyStateMessage(goals, recipes, 20)
	if !strings.Contains(msg, "Reflex") {
		t.Errorf("expected Reflex in message, got: %s", msg)
	}
	if !strings.Contains(msg, "raw ore") {
		t.Errorf("expected 'raw ore' in message, got: %s", msg)
	}
}

func TestEmptyStateMessage_HighCorruption(t *testing.T) {
	msg := EmptyStateMessage(DefaultGoals(), chain.NewRecipeRegistry(), 80)
	if !strings.Contains(msg, "nothing") {
		t.Errorf("expected corrupted message, got: %s", msg)
	}
}

func TestEmptyStateMessage_NoGoals(t *testing.T) {
	msg := EmptyStateMessage(nil, nil, 20)
	if !strings.Contains(msg, "no materials") {
		t.Errorf("expected fallback message, got: %s", msg)
	}
}
