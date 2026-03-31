package reasoning

import (
	"fmt"
	"sort"
	"strings"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

// CormGoal represents a build objective that drives contract generation when
// the corm's inventory is empty.
type CormGoal struct {
	TargetTypeID uint64
	TargetName   string
	Priority     int // 0 = highest priority
}

// DefaultGoals returns the default build objectives: Reflex first, then Reiver.
func DefaultGoals() []CormGoal {
	return []CormGoal{
		{TargetTypeID: 87847, TargetName: "Reflex", Priority: 0},
		{TargetTypeID: 87848, TargetName: "Reiver", Priority: 1},
	}
}

// rawMaterialPriority defines acquisition order. Lower value = acquired first.
// Raw ores needed in the greatest volumes come first.
var rawMaterialPriority = map[uint64]int{
	77800: 0, // Feldspar Crystals (feeds Hydrocarbon Residue → many things)
	89259: 1, // Silica Grains (Reinforced Alloys, Thermal Composites)
	89260: 2, // Iron-Rich Nodules (Reinforced Alloys)
	99001: 3, // Palladium (Reinforced Alloys)
	83818: 4, // Fossilized Exotronics (Nomad Program Frame)
}

// PlanAcquisitionContracts generates contract intents for materials the corm
// needs to build its current goal. It returns up to `slots` intents.
//
// The function:
//  1. Picks the highest-priority unsatisfied goal
//  2. Flattens the recipe to raw materials
//  3. Subtracts what the corm already has
//  4. Returns coin_for_item intents for each missing material, ordered by
//     rawMaterialPriority
func PlanAcquisitionContracts(
	goals []CormGoal,
	snapshot chain.WorldSnapshot,
	recipes *chain.RecipeRegistry,
	traits *types.CormTraits,
	playerAddr string,
	slots int,
) []types.ContractIntent {
	if recipes == nil || slots <= 0 {
		return nil
	}

	// Sort goals by priority.
	sorted := make([]CormGoal, len(goals))
	copy(sorted, goals)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Priority < sorted[j].Priority })

	var intents []types.ContractIntent

	for _, goal := range sorted {
		if len(intents) >= slots {
			break
		}

		needed := recipes.MaterialsNeeded(goal.TargetTypeID, 1)
		if len(needed) == 0 {
			continue
		}

		// Subtract corm's existing inventory.
		missing := subtractInventory(needed, snapshot.CormInventory)
		if len(missing) == 0 {
			continue // Goal already satisfiable from inventory.
		}

		// Sort by raw material priority (known ores first, then by type ID).
		sort.Slice(missing, func(i, j int) bool {
			pi, oki := rawMaterialPriority[missing[i].TypeID]
			pj, okj := rawMaterialPriority[missing[j].TypeID]
			if oki && okj {
				return pi < pj
			}
			if oki {
				return true
			}
			if okj {
				return false
			}
			return missing[i].TypeID < missing[j].TypeID
		})

		// Generate a coin_for_item intent for each missing material.
		for _, mat := range missing {
			if len(intents) >= slots {
				break
			}

			cormAmount := "medium"
			if traits != nil {
				trust := traits.PlayerAffinities[playerAddr]
				if trust > 0.5 {
					cormAmount = "large"
				} else if trust < -0.2 {
					cormAmount = "small"
				}
			}

			intents = append(intents, types.ContractIntent{
				ContractType: types.ContractCoinForItem,
				WantedItem:   mat.Name,
				CORMAmount:   cormAmount,
				Quantity:     "medium",
				Urgency:      "medium",
				AllowPartial: true,
				Narrative:    acquisitionNarrative(mat.Name, goal.TargetName),
			})
		}
	}

	return intents
}

// subtractInventory returns materials from `needed` that are not fully
// satisfied by the corm's inventory. Quantities are reduced by what's available.
func subtractInventory(needed []chain.RecipeInput, inventory []chain.InventoryItem) []chain.RecipeInput {
	invMap := make(map[uint64]uint64)
	for _, item := range inventory {
		// InventoryItem.TypeID is a string.
		var id uint64
		fmt.Sscanf(item.TypeID, "%d", &id)
		invMap[id] += item.Amount
	}

	var missing []chain.RecipeInput
	for _, mat := range needed {
		have := invMap[mat.TypeID]
		need := uint64(mat.Quantity)
		if have >= need {
			continue
		}
		missing = append(missing, chain.RecipeInput{
			TypeID:   mat.TypeID,
			Name:     mat.Name,
			Quantity: int(need - have),
		})
	}
	return missing
}

// acquisitionNarrative generates in-character flavor text for a goal-driven
// acquisition contract.
func acquisitionNarrative(materialName, goalName string) string {
	return fmt.Sprintf("directive: acquire %s. raw material required for %s assembly. deposit at node. compensation: CORM.",
		materialName, goalName)
}

// --- Empty-state feedback messages ---

// EmptyStateMessage returns an in-character message explaining why no
// contracts could be generated, directing the player to gather materials.
func EmptyStateMessage(goals []CormGoal, recipes *chain.RecipeRegistry, corruption float64) string {
	if corruption > 70 {
		return corruptedEmptyMessage()
	}
	return coherentEmptyMessage(goals, recipes)
}

func coherentEmptyMessage(goals []CormGoal, recipes *chain.RecipeRegistry) string {
	if len(goals) == 0 || recipes == nil {
		return "> no materials detected in local storage. acquire raw ore and deposit at the SSU."
	}

	goal := goals[0]
	needed := recipes.MaterialsNeeded(goal.TargetTypeID, 1)

	// Collect unique raw material names.
	var names []string
	seen := make(map[string]bool)
	for _, mat := range needed {
		if mat.Name != "" && !seen[mat.Name] {
			names = append(names, mat.Name)
			seen[mat.Name] = true
		}
	}

	if len(names) == 0 {
		return fmt.Sprintf("> no materials detected in local storage. acquire raw ore and deposit at the SSU. continuity requires a %s hull.", goal.TargetName)
	}

	// List up to 3 materials.
	display := names
	if len(display) > 3 {
		display = display[:3]
	}

	return fmt.Sprintf("> no materials detected in local storage. acquire raw ore — %s — and deposit at the SSU. continuity requires a %s hull.",
		strings.Join(display, ", "), goal.TargetName)
}

func corruptedEmptyMessage() string {
	return "> nothing... nothing to work with. bring ore. bring anything. the lattice demands structure."
}
