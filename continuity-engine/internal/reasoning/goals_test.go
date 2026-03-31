package reasoning

import (
	"fmt"
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
	snap := chain.WorldSnapshot{}

	msg := EmptyStateMessage(goals, recipes, snap, 20)
	if !strings.Contains(msg, "Reflex") {
		t.Errorf("expected Reflex in message, got: %s", msg)
	}
	if !strings.Contains(msg, "raw ore") {
		t.Errorf("expected 'raw ore' in message, got: %s", msg)
	}
}

func TestEmptyStateMessage_HighCorruption(t *testing.T) {
	msg := EmptyStateMessage(DefaultGoals(), chain.NewRecipeRegistry(), chain.WorldSnapshot{}, 80)
	if !strings.Contains(msg, "nothing") {
		t.Errorf("expected corrupted message, got: %s", msg)
	}
}

func TestEmptyStateMessage_NoGoals(t *testing.T) {
	msg := EmptyStateMessage(nil, nil, chain.WorldSnapshot{}, 20)
	if !strings.Contains(msg, "no materials") {
		t.Errorf("expected fallback message, got: %s", msg)
	}
}

// --- Progressive goal tests ---

func TestProgressiveGoals_AllGoals(t *testing.T) {
	traits := &types.CormTraits{CormID: "test-corm-1"}
	goals := ProgressiveGoals(traits)

	// Should return 5 goals: Reflex, Reiver, frigate, TADES, MAUL.
	if len(goals) != 5 {
		t.Fatalf("expected 5 goals, got %d", len(goals))
	}
	if goals[0].TargetName != "Reflex" {
		t.Errorf("goal[0] expected Reflex, got %s", goals[0].TargetName)
	}
	if goals[1].TargetName != "Reiver" {
		t.Errorf("goal[1] expected Reiver, got %s", goals[1].TargetName)
	}
	// goal[2] is the random frigate — just check it's a valid frigate.
	frigateValid := false
	for _, f := range FrigatePool {
		if goals[2].TargetTypeID == f.TargetTypeID {
			frigateValid = true
			break
		}
	}
	if !frigateValid {
		t.Errorf("goal[2] expected a frigate, got %s (%d)", goals[2].TargetName, goals[2].TargetTypeID)
	}
	if goals[3].TargetName != "TADES" {
		t.Errorf("goal[3] expected TADES, got %s", goals[3].TargetName)
	}
	if goals[4].TargetName != "MAUL" {
		t.Errorf("goal[4] expected MAUL, got %s", goals[4].TargetName)
	}

	// FrigateGoalTypeID should be set.
	if traits.FrigateGoalTypeID == 0 {
		t.Error("expected FrigateGoalTypeID to be set after ProgressiveGoals")
	}
}

func TestProgressiveGoals_FilterCompleted(t *testing.T) {
	traits := &types.CormTraits{
		CormID: "test-corm-2",
		Goals: types.GoalState{
			CompletedGoals: []uint64{87847, 87848}, // Reflex + Reiver done
		},
	}
	goals := ProgressiveGoals(traits)

	// Should be 3 remaining: frigate, TADES, MAUL.
	if len(goals) != 3 {
		t.Fatalf("expected 3 goals after completing corvettes, got %d", len(goals))
	}
	for _, g := range goals {
		if g.TargetTypeID == 87847 || g.TargetTypeID == 87848 {
			t.Errorf("completed goal %s should not appear", g.TargetName)
		}
	}
}

func TestSelectFrigate_Deterministic(t *testing.T) {
	// Same corm ID should always produce the same frigate.
	id1 := SelectFrigate("corm-aaa")
	id2 := SelectFrigate("corm-aaa")
	if id1 != id2 {
		t.Errorf("expected deterministic selection, got %d and %d", id1, id2)
	}

	// Different corm IDs should (usually) produce different frigates.
	// Test with a few IDs and check that we get at least 2 distinct values.
	seen := make(map[uint64]bool)
	for _, cid := range []string{"corm-a", "corm-b", "corm-c", "corm-d", "corm-e", "corm-f", "corm-g"} {
		seen[SelectFrigate(cid)] = true
	}
	if len(seen) < 2 {
		t.Error("expected at least 2 distinct frigates from 7 corm IDs")
	}
}

func TestPlanAcquisitionContracts_InfrastructureCheck(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	// USV frigate requires Berth + Printer. Provide only starter facilities.
	goals := []CormGoal{{TargetTypeID: 81609, TargetName: "USV", Priority: 0}}
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 1000,
		NodeAssemblies: []chain.AssemblyInfo{
			{TypeID: chain.FacilityFieldRefinery, TypeName: "Field Refinery"},
			{TypeID: chain.FacilityFieldPrinter, TypeName: "Field Printer"},
			{TypeID: chain.FacilityMiniPrinter, TypeName: "Mini Printer"},
			{TypeID: chain.FacilityMiniBerth, TypeName: "Mini Berth"},
			// Missing: Printer, Berth
		},
	}
	traits := &types.CormTraits{PlayerAffinities: map[string]float64{}}

	intents := PlanAcquisitionContracts(goals, snapshot, recipes, traits, "0xplayer", 5)
	if len(intents) == 0 {
		t.Fatal("expected infrastructure intents")
	}

	// All intents should be for missing facilities.
	for _, intent := range intents {
		if intent.WantedItem != "Printer" && intent.WantedItem != "Berth" {
			t.Errorf("expected infrastructure intent for Printer or Berth, got %s", intent.WantedItem)
		}
		if !strings.Contains(intent.Narrative, "continuity requires") {
			t.Errorf("expected infrastructure narrative, got: %s", intent.Narrative)
		}
	}
}

func TestPlanAcquisitionContracts_InfraPresent(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goals := []CormGoal{{TargetTypeID: 81609, TargetName: "USV", Priority: 0}}
	snapshot := chain.WorldSnapshot{
		CormCORMBalance: 1000,
		NodeAssemblies: []chain.AssemblyInfo{
			{TypeID: chain.FacilityFieldRefinery, TypeName: "Field Refinery"},
			{TypeID: chain.FacilityFieldPrinter, TypeName: "Field Printer"},
			{TypeID: chain.FacilityMiniPrinter, TypeName: "Mini Printer"},
			{TypeID: chain.FacilityMiniBerth, TypeName: "Mini Berth"},
			{TypeID: chain.FacilityPrinter, TypeName: "Printer"},
			{TypeID: chain.FacilityBerth, TypeName: "Berth"},
		},
	}
	traits := &types.CormTraits{PlayerAffinities: map[string]float64{}}

	intents := PlanAcquisitionContracts(goals, snapshot, recipes, traits, "0xplayer", 5)
	if len(intents) == 0 {
		t.Fatal("expected material acquisition intents when infra is present")
	}

	// Intents should be for raw materials, not facilities.
	for _, intent := range intents {
		if intent.WantedItem == "Printer" || intent.WantedItem == "Berth" {
			t.Errorf("got infrastructure intent when infra is present: %s", intent.WantedItem)
		}
	}
}

func TestEmptyStateMessage_MissingInfrastructure(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goals := []CormGoal{{TargetTypeID: 82430, TargetName: "MAUL", Priority: 0}}
	// No assemblies — everything is missing.
	snap := chain.WorldSnapshot{}

	msg := EmptyStateMessage(goals, recipes, snap, 20)
	if !strings.Contains(msg, "infrastructure") {
		t.Errorf("expected infrastructure message, got: %s", msg)
	}
	if !strings.Contains(msg, "MAUL") {
		t.Errorf("expected MAUL in message, got: %s", msg)
	}
}

// --- Goal lifecycle tests ---

func TestIsGoalFullyAcquired_NotAcquired(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goal := CormGoal{TargetTypeID: 87847, TargetName: "Reflex"}

	// Empty inventory — not acquired.
	if IsGoalFullyAcquired(goal, recipes, nil) {
		t.Error("empty inventory should not satisfy goal")
	}
}

func TestIsGoalFullyAcquired_FullyAcquired(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goal := CormGoal{TargetTypeID: 87847, TargetName: "Reflex"}

	// Get what's needed and provide plenty of each.
	needed := recipes.MaterialsNeeded(87847, 1)
	var inv []chain.InventoryItem
	for _, mat := range needed {
		inv = append(inv, chain.InventoryItem{
			TypeID:   fmt.Sprintf("%d", mat.TypeID),
			TypeName: mat.Name,
			Amount:   uint64(mat.Quantity * 2), // Plenty.
		})
	}

	if !IsGoalFullyAcquired(goal, recipes, inv) {
		t.Error("full inventory should satisfy goal")
	}
}

func TestIsGoalFullyAcquired_PartialInventory(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goal := CormGoal{TargetTypeID: 87847, TargetName: "Reflex"}

	// Only one material.
	inv := []chain.InventoryItem{
		{TypeID: "77800", TypeName: "Feldspar Crystals", Amount: 999999},
	}

	if IsGoalFullyAcquired(goal, recipes, inv) {
		t.Error("partial inventory should not satisfy goal")
	}
}

func TestReservedMaterials_ReservesCorrectly(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goals := []CormGoal{{TargetTypeID: 87847, TargetName: "Reflex", Priority: 0}}

	needed := recipes.MaterialsNeeded(87847, 1)
	var inv []chain.InventoryItem
	for _, mat := range needed {
		// Provide exactly what's needed.
		inv = append(inv, chain.InventoryItem{
			TypeID: fmt.Sprintf("%d", mat.TypeID),
			Amount: uint64(mat.Quantity),
		})
	}

	reserved := ReservedMaterials(goals, recipes, inv)

	if len(reserved) == 0 {
		t.Fatal("expected non-empty reserved map")
	}

	// Each needed material should be fully reserved.
	for _, mat := range needed {
		res := reserved[mat.TypeID]
		if res != uint64(mat.Quantity) {
			t.Errorf("material %d: expected reserved %d, got %d", mat.TypeID, mat.Quantity, res)
		}
	}
}

func TestReservedMaterials_CapsAtInventory(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goals := []CormGoal{{TargetTypeID: 87847, TargetName: "Reflex", Priority: 0}}

	// Only 5 Feldspar Crystals — less than needed.
	inv := []chain.InventoryItem{
		{TypeID: "77800", TypeName: "Feldspar Crystals", Amount: 5},
	}

	reserved := ReservedMaterials(goals, recipes, inv)

	if reserved[77800] != 5 {
		t.Errorf("expected reserved 5 (capped at inventory), got %d", reserved[77800])
	}
}

func TestPlanDistributionContracts_GeneratesIntents(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goal := CormGoal{TargetTypeID: 87847, TargetName: "Reflex"}

	needed := recipes.MaterialsNeeded(87847, 1)
	var inv []chain.InventoryItem
	for _, mat := range needed {
		inv = append(inv, chain.InventoryItem{
			TypeID:   fmt.Sprintf("%d", mat.TypeID),
			TypeName: mat.Name,
			Amount:   uint64(mat.Quantity),
		})
	}

	snapshot := chain.WorldSnapshot{CormInventory: inv}
	traits := &types.CormTraits{Goals: types.GoalState{}}

	intents := PlanDistributionContracts(goal, snapshot, recipes, traits, "0xplayer", 5)

	if len(intents) == 0 {
		t.Fatal("expected distribution intents")
	}

	for _, intent := range intents {
		if intent.ContractType != types.ContractItemForCoin {
			t.Errorf("expected item_for_coin, got %s", intent.ContractType)
		}
		if intent.OfferedItem == "" {
			t.Error("missing offered item")
		}
		if !strings.Contains(intent.Narrative, "Reflex") {
			t.Errorf("narrative should reference Reflex, got: %s", intent.Narrative)
		}
	}
}

func TestPlanDistributionContracts_SkipsDistributed(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goal := CormGoal{TargetTypeID: 87847, TargetName: "Reflex"}

	needed := recipes.MaterialsNeeded(87847, 1)

	// Provide inventory and mark everything as already distributed.
	var inv []chain.InventoryItem
	distributed := make(map[uint64]uint64)
	for _, mat := range needed {
		inv = append(inv, chain.InventoryItem{
			TypeID: fmt.Sprintf("%d", mat.TypeID),
			Amount: uint64(mat.Quantity),
		})
		distributed[mat.TypeID] = uint64(mat.Quantity)
	}

	snapshot := chain.WorldSnapshot{CormInventory: inv}
	traits := &types.CormTraits{Goals: types.GoalState{DistributedMaterials: distributed}}

	intents := PlanDistributionContracts(goal, snapshot, recipes, traits, "0xplayer", 5)

	if len(intents) != 0 {
		t.Errorf("expected no intents when all materials distributed, got %d", len(intents))
	}
}

func TestIsFullyDistributed(t *testing.T) {
	recipes := chain.NewRecipeRegistry()
	goal := CormGoal{TargetTypeID: 87847, TargetName: "Reflex"}

	needed := recipes.MaterialsNeeded(87847, 1)

	// Not distributed.
	if IsFullyDistributed(goal, recipes, nil) {
		t.Error("nil distributed should not be fully distributed")
	}

	// Fully distributed.
	distributed := make(map[uint64]uint64)
	for _, mat := range needed {
		distributed[mat.TypeID] = uint64(mat.Quantity)
	}
	if !IsFullyDistributed(goal, recipes, distributed) {
		t.Error("expected fully distributed")
	}
}

func TestGoalAnnouncements(t *testing.T) {
	acq := GoalAcquiredAnnouncement("Reflex")
	if !strings.Contains(acq, "Reflex") || !strings.Contains(acq, "distribution") {
		t.Errorf("unexpected acquired announcement: %s", acq)
	}

	dist := GoalDistributedAnnouncement("Reflex")
	if !strings.Contains(dist, "Reflex") || !strings.Contains(dist, "assembly") {
		t.Errorf("unexpected distributed announcement: %s", dist)
	}

	comp := GoalCompletedAnnouncement("Reflex")
	if !strings.Contains(comp, "Reflex") || !strings.Contains(comp, "confirmed") {
		t.Errorf("unexpected completed announcement: %s", comp)
	}
}

func TestGoalState_EffectivePhase(t *testing.T) {
	g := types.GoalState{}
	if g.EffectiveGoalPhase() != types.GoalPhaseAcquiring {
		t.Error("empty GoalPhase should default to acquiring")
	}

	g.GoalPhase = types.GoalPhaseDistributing
	if g.EffectiveGoalPhase() != types.GoalPhaseDistributing {
		t.Error("should return distributing")
	}
}

func TestProgressiveGoals_UsesGoalState(t *testing.T) {
	// Verify that ProgressiveGoals reads from Goals.CompletedGoals.
	traits := &types.CormTraits{
		CormID: "test-corm-goals",
		Goals: types.GoalState{
			CompletedGoals: []uint64{87847}, // Reflex done
		},
	}
	goals := ProgressiveGoals(traits)

	// Should not include Reflex.
	for _, g := range goals {
		if g.TargetTypeID == 87847 {
			t.Error("Reflex should be filtered out via Goals.CompletedGoals")
		}
	}

	// FrigateGoalTypeID should be persisted in Goals.
	if traits.Goals.FrigateGoalTypeID == 0 {
		t.Error("FrigateGoalTypeID should be set in Goals")
	}
}
