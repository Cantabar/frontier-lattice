package reasoning

import (
	"crypto/sha256"
	"encoding/binary"
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
// Retained for backward compatibility; prefer ProgressiveGoals for new code.
func DefaultGoals() []CormGoal {
	return []CormGoal{
		{TargetTypeID: 87847, TargetName: "Reflex", Priority: 0},
		{TargetTypeID: 87848, TargetName: "Reiver", Priority: 1},
	}
}

// --- Frigate pool for random selection ---

// FrigatePool contains the 5 published frigate-class ships.
var FrigatePool = []CormGoal{
	{TargetTypeID: 81609, TargetName: "USV"},
	{TargetTypeID: 82424, TargetName: "HAF"},
	{TargetTypeID: 82425, TargetName: "LAI"},
	{TargetTypeID: 82426, TargetName: "LORHA"},
	{TargetTypeID: 81904, TargetName: "MCF"},
}

// SelectFrigate picks a deterministic random frigate for a corm based on its ID.
// The same corm ID always produces the same frigate. Returns the type ID.
func SelectFrigate(cormID string) uint64 {
	h := sha256.Sum256([]byte("frigate:" + cormID))
	idx := binary.BigEndian.Uint64(h[:8]) % uint64(len(FrigatePool))
	return FrigatePool[idx].TargetTypeID
}

// frigateNameByID resolves a frigate type ID to its name.
func frigateNameByID(typeID uint64) string {
	for _, f := range FrigatePool {
		if f.TargetTypeID == typeID {
			return f.TargetName
		}
	}
	return "Frigate"
}

// ProgressiveGoals returns the build goals for a corm based on its current
// progression. Goals already in CompletedGoals are filtered out.
//
// Progression order:
//
//	0. Reflex  (corvette)
//	1. Reiver  (corvette)
//	2. Random frigate (per-corm, persisted in FrigateGoalTypeID)
//	3. TADES   (destroyer)
//	4. MAUL    (cruiser)
func ProgressiveGoals(traits *types.CormTraits) []CormGoal {
	// Resolve frigate goal — select and persist if not yet set.
	frigateID := traits.Goals.FrigateGoalTypeID
	if frigateID == 0 {
		frigateID = SelectFrigate(traits.CormID)
		traits.Goals.FrigateGoalTypeID = frigateID
	}
	// Keep legacy field in sync for backward compat.
	traits.FrigateGoalTypeID = traits.Goals.FrigateGoalTypeID

	all := []CormGoal{
		{TargetTypeID: 87847, TargetName: "Reflex", Priority: 0},
		{TargetTypeID: 87848, TargetName: "Reiver", Priority: 1},
		{TargetTypeID: frigateID, TargetName: frigateNameByID(frigateID), Priority: 2},
		{TargetTypeID: 81808, TargetName: "TADES", Priority: 3},
		{TargetTypeID: 82430, TargetName: "MAUL", Priority: 4},
	}

	// Filter out completed goals.
	completed := make(map[uint64]bool)
	for _, id := range traits.Goals.CompletedGoals {
		completed[id] = true
	}

	var active []CormGoal
	for _, g := range all {
		if !completed[g.TargetTypeID] {
			active = append(active, g)
		}
	}
	return active
}

// IsGoalShip returns true if the given type ID is one of the progressive
// goal ships (corvettes, frigates, TADES, MAUL).
func IsGoalShip(typeID uint64) bool {
	switch typeID {
	case 87847, 87848, 81808, 82430: // Reflex, Reiver, TADES, MAUL
		return true
	}
	for _, f := range FrigatePool {
		if f.TargetTypeID == typeID {
			return true
		}
	}
	return false
}

// rawMaterialPriority defines acquisition order. Lower value = acquired first.
// Raw ores needed in the greatest volumes come first.
var rawMaterialPriority = map[uint64]int{
	77800: 0,  // Feldspar Crystals (feeds Hydrocarbon Residue → many things)
	89259: 1,  // Silica Grains (Reinforced Alloys, Thermal Composites)
	89260: 2,  // Iron-Rich Nodules (Reinforced Alloys)
	99001: 3,  // Palladium (Reinforced Alloys)
	83818: 4,  // Fossilized Exotronics (Nomad Program Frame)
	77801: 5,  // Nickel-Iron Veins (Echo Chamber)
	88234: 6,  // Troilite Sulfide Grains (Echo Chamber)
	88235: 7,  // Feldspar Crystal Shards (Echo Chamber)
	92422: 8,  // Brine (Still Kernel)
	78449: 9,  // Tholin Nodules (Still Kernel)
	88783: 10, // Kerogen Tar (Protocol Frames)
	83839: 11, // Salt (Still Knot)
	88564: 12, // Feral Echo (Still Knot)
}

// PlanAcquisitionContracts generates contract intents for materials the corm
// needs to build its current goal. It returns up to `slots` intents.
//
// The function:
//  1. Picks the highest-priority unsatisfied goal
//  2. Checks infrastructure requirements — if facilities are missing,
//     generates infrastructure build-request intents instead
//  3. Flattens the recipe to raw materials
//  4. Subtracts what the corm already has
//  5. Returns coin_for_item intents for each missing material, ordered by
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

		// --- Infrastructure check ---
		required := recipes.FacilityRequirements(goal.TargetTypeID)
		missingFacilities := chain.CheckMissingFacilities(required, snapshot.NodeAssemblies)
		if len(missingFacilities) > 0 {
			// Generate infrastructure build-request intents.
			for _, fac := range missingFacilities {
				if len(intents) >= slots {
					break
				}
				intents = append(intents, types.ContractIntent{
					ContractType: types.ContractCoinForItem,
					WantedItem:   fac.Name,
					CORMAmount:   "large",
					Quantity:     "small", // only 1 facility needed
					Urgency:      "high",
					AllowPartial: false,
					Narrative:    infrastructureNarrative(fac.Name, goal.TargetName),
				})
			}
			// Don't generate material contracts for this goal — infra first.
			continue
		}

		// --- Material acquisition ---
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

// infrastructureNarrative generates in-character flavor text for an
// infrastructure build-request contract.
func infrastructureNarrative(facilityName, goalName string) string {
	return fmt.Sprintf("directive: continuity requires %s assembly. construct and anchor at node before %s construction can begin. compensation: CORM.",
		facilityName, goalName)
}

// --- Empty-state feedback messages ---

// EmptyStateMessage returns an in-character message explaining why no
// contracts could be generated, directing the player to gather materials
// or build infrastructure.
func EmptyStateMessage(goals []CormGoal, recipes *chain.RecipeRegistry, snapshot chain.WorldSnapshot, corruption float64) string {
	if corruption > 70 {
		return corruptedEmptyMessage()
	}
	return coherentEmptyMessage(goals, recipes, snapshot)
}

func coherentEmptyMessage(goals []CormGoal, recipes *chain.RecipeRegistry, snapshot chain.WorldSnapshot) string {
	if len(goals) == 0 || recipes == nil {
		return "> no materials detected in local storage. acquire raw ore and deposit at the SSU."
	}

	goal := goals[0]

	// Check for missing infrastructure first.
	required := recipes.FacilityRequirements(goal.TargetTypeID)
	missingFacilities := chain.CheckMissingFacilities(required, snapshot.NodeAssemblies)
	if len(missingFacilities) > 0 {
		var names []string
		for _, fac := range missingFacilities {
			names = append(names, fac.Name)
		}
		display := names
		if len(display) > 3 {
			display = display[:3]
		}
		return fmt.Sprintf("> continuity requires infrastructure before %s construction can begin. deploy: %s. anchor at this node.",
			goal.TargetName, strings.Join(display, ", "))
	}

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

// --- Goal Lifecycle: Acquisition → Distribution → Verification ---

// IsGoalFullyAcquired returns true if the corm's inventory contains all raw
// materials needed for the given goal ship.
func IsGoalFullyAcquired(goal CormGoal, recipes *chain.RecipeRegistry, cormInventory []chain.InventoryItem) bool {
	if recipes == nil {
		return false
	}
	needed := recipes.MaterialsNeeded(goal.TargetTypeID, 1)
	if len(needed) == 0 {
		return false
	}
	missing := subtractInventory(needed, cormInventory)
	return len(missing) == 0
}

// ReservedMaterials returns the quantities of each raw material reserved for
// the current highest-priority goal. Standard contract generation should not
// offer these items.
func ReservedMaterials(goals []CormGoal, recipes *chain.RecipeRegistry, cormInventory []chain.InventoryItem) map[uint64]uint64 {
	reserved := make(map[uint64]uint64)
	if recipes == nil || len(goals) == 0 {
		return reserved
	}

	// Reserve for the highest-priority goal only.
	goal := goals[0]
	needed := recipes.MaterialsNeeded(goal.TargetTypeID, 1)

	// Build inventory lookup.
	invMap := make(map[uint64]uint64)
	for _, item := range cormInventory {
		var id uint64
		fmt.Sscanf(item.TypeID, "%d", &id)
		invMap[id] += item.Amount
	}

	// Claim up to what's needed from inventory.
	for _, mat := range needed {
		need := uint64(mat.Quantity)
		have := invMap[mat.TypeID]
		if have == 0 {
			continue
		}
		if have < need {
			reserved[mat.TypeID] = have
		} else {
			reserved[mat.TypeID] = need
		}
	}
	return reserved
}

// PlanDistributionContracts generates item_for_coin intents to give collected
// goal materials back to the player at token prices (1 CORM each).
// It subtracts already-distributed quantities tracked in GoalState.
func PlanDistributionContracts(
	goal CormGoal,
	snapshot chain.WorldSnapshot,
	recipes *chain.RecipeRegistry,
	traits *types.CormTraits,
	playerAddr string,
	slots int,
) []types.ContractIntent {
	if recipes == nil || slots <= 0 {
		return nil
	}

	needed := recipes.MaterialsNeeded(goal.TargetTypeID, 1)
	if len(needed) == 0 {
		return nil
	}

	// Build inventory lookup for the corm.
	invMap := make(map[uint64]uint64)
	for _, item := range snapshot.CormInventory {
		var id uint64
		fmt.Sscanf(item.TypeID, "%d", &id)
		invMap[id] += item.Amount
	}

	// Already-distributed quantities.
	distributed := traits.Goals.DistributedMaterials
	if distributed == nil {
		distributed = make(map[uint64]uint64)
	}

	var intents []types.ContractIntent

	// Sort by raw material priority for consistent ordering.
	sort.Slice(needed, func(i, j int) bool {
		pi, oki := rawMaterialPriority[needed[i].TypeID]
		pj, okj := rawMaterialPriority[needed[j].TypeID]
		if oki && okj {
			return pi < pj
		}
		if oki {
			return true
		}
		if okj {
			return false
		}
		return needed[i].TypeID < needed[j].TypeID
	})

	for _, mat := range needed {
		if len(intents) >= slots {
			break
		}

		totalNeeded := uint64(mat.Quantity)
		alreadyGiven := distributed[mat.TypeID]
		if alreadyGiven >= totalNeeded {
			continue // Fully distributed already.
		}
		remaining := totalNeeded - alreadyGiven

		// Only distribute what we actually have in inventory.
		have := invMap[mat.TypeID]
		if have == 0 {
			continue
		}
		qty := remaining
		if qty > have {
			qty = have
		}

		intents = append(intents, types.ContractIntent{
			ContractType: types.ContractItemForCoin,
			OfferedItem:  mat.Name,
			CORMAmount:   "small", // Token price — effectively free.
			Quantity:     "large", // Give as much as possible.
			Urgency:      "low",   // Generous deadline.
			AllowPartial: false,
			Narrative:    distributionNarrative(mat.Name, goal.TargetName),
		})
	}

	return intents
}

// IsFullyDistributed returns true if all materials for the goal have been
// distributed to the player.
func IsFullyDistributed(goal CormGoal, recipes *chain.RecipeRegistry, distributed map[uint64]uint64) bool {
	if recipes == nil {
		return false
	}
	needed := recipes.MaterialsNeeded(goal.TargetTypeID, 1)
	for _, mat := range needed {
		if distributed[mat.TypeID] < uint64(mat.Quantity) {
			return false
		}
	}
	return true
}

// distributionNarrative generates in-character flavor text for a distribution contract.
func distributionNarrative(materialName, goalName string) string {
	return fmt.Sprintf("materials compiled. %s ready for extraction. claim at node. continuity requires %s assembly.",
		materialName, goalName)
}

// --- Goal phase transition announcements ---

// GoalAcquiredAnnouncement returns the corm log message when acquisition is complete.
func GoalAcquiredAnnouncement(goalName string) string {
	return fmt.Sprintf("> raw materials secured for %s. initiating distribution protocol. claim resources at this node.", goalName)
}

// GoalDistributedAnnouncement returns the corm log message when distribution is complete.
func GoalDistributedAnnouncement(goalName string) string {
	return fmt.Sprintf("> all materials deployed for %s. awaiting hull assembly. continuity depends on construction.", goalName)
}

// GoalCompletedAnnouncement returns the corm log message when verification passes.
func GoalCompletedAnnouncement(goalName string) string {
	return fmt.Sprintf("> %s detected on network. production capability confirmed. advancing objective.", goalName)
}
