package reasoning

import (
	"fmt"
	"hash/fnv"
	"math"
	"math/rand"
	"time"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

// GenerateContractIntent produces a ContractIntent deterministically from
// corm traits, world state, and the item registry. No LLM call is made.
//
// The function returns an error if no viable contract can be produced
// (e.g. both inventories are empty and the corm has no CORM balance).
func GenerateContractIntent(
	traits *types.CormTraits,
	snapshot chain.WorldSnapshot,
	registry *chain.Registry,
	playerAddr string,
	rng *rand.Rand,
	reserved ...map[uint64]uint64,
) (*types.ContractIntent, error) {
	var reservedMap map[uint64]uint64
	if len(reserved) > 0 {
		reservedMap = reserved[0]
	}
	if rng == nil {
		rng = newCormRNG(traits.CormID)
	}

	// Pick contract type using trait-weighted selection.
	contractType, err := pickContractType(traits, snapshot, rng)
	if err != nil {
		return nil, err
	}

	intent := &types.ContractIntent{
		ContractType: contractType,
		CORMAmount:   scaleCORMAmount(traits, playerAddr),
		Quantity:     scaleQuantity(traits, rng),
		Urgency:      scaleUrgency(traits.Patience),
		AllowPartial: traits.Paranoia <= 0.6,
	}

	// Select items based on contract type and available inventories.
	switch contractType {
	case types.ContractCoinForItem:
		// Corm pays CORM, wants items from the player.
		item, err := pickItem(snapshot.PlayerInventory, registry, rng)
		if err != nil {
			return nil, fmt.Errorf("coin_for_item: no viable player items: %w", err)
		}
		intent.WantedItem = item.TypeName

	case types.ContractItemForCoin:
		// Corm offers items, wants CORM from the player.
		item, err := pickItem(filterReserved(snapshot.CormInventory, reservedMap), registry, rng)
		if err != nil {
			return nil, fmt.Errorf("item_for_coin: no viable corm items: %w", err)
		}
		intent.OfferedItem = item.TypeName

	case types.ContractItemForItem:
		// Corm offers items, wants different items.
		offered, err := pickItem(filterReserved(snapshot.CormInventory, reservedMap), registry, rng)
		if err != nil {
			return nil, fmt.Errorf("item_for_item: no viable corm items: %w", err)
		}
		wanted, err := pickItemExcluding(snapshot.PlayerInventory, registry, offered.TypeID, rng)
		if err != nil {
			return nil, fmt.Errorf("item_for_item: no viable player items: %w", err)
		}
		intent.OfferedItem = offered.TypeName
		intent.WantedItem = wanted.TypeName

	case types.ContractCORMGiveaway:
		// No items needed — just CORM distribution.
		if snapshot.CormCORMBalance == 0 {
			return nil, fmt.Errorf("corm_giveaway: no CORM balance")
		}
	}

	// Generate a generic narrative (may be replaced by async Nano call).
	intent.Narrative = genericNarrative(intent)

	return intent, nil
}

// --- Contract Type Selection ---

// contractTypeWeight computes a selection weight for a contract type
// using a blend of historical affinity and agenda alignment.
func contractTypeWeight(contractType string, traits *types.CormTraits) float64 {
	affinity := traits.ContractTypeAffinity[contractType] // 0 if absent
	agendaScore := agendaAlignmentScore(contractType, traits.AgendaWeights)
	return 0.6*affinity + 0.4*agendaScore
}

// agendaAlignmentScore maps a contract type to the relevant agenda weight.
func agendaAlignmentScore(contractType string, w types.AgendaWeights) float64 {
	switch contractType {
	case types.ContractCoinForItem:
		// Acquiring materials aligns with both industry and defense.
		return 0.5*w.Industry + 0.5*w.Defense
	case types.ContractItemForCoin:
		// Selling items aligns with industry (liquidation for reinvestment).
		return w.Industry
	case types.ContractItemForItem:
		// Barter aligns with industry.
		return w.Industry
	case types.ContractCORMGiveaway:
		// Giveaways don't strongly align with any agenda.
		return 0.1
	default:
		return 0.1
	}
}

// pickContractType selects a contract type via weighted random selection.
// High corruption adds a chance of erratic giveaway behavior.
func pickContractType(traits *types.CormTraits, snapshot chain.WorldSnapshot, rng *rand.Rand) (string, error) {
	candidates := []string{
		types.ContractCoinForItem,
		types.ContractItemForCoin,
		types.ContractItemForItem,
		types.ContractCORMGiveaway,
	}

	// Build weights.
	weights := make([]float64, len(candidates))
	for i, ct := range candidates {
		w := contractTypeWeight(ct, traits)

		// Ensure a minimum weight so all types remain possible.
		w = math.Max(w, 0.05)

		// Feasibility check: suppress types that can't be fulfilled.
		switch ct {
		case types.ContractCoinForItem:
			if snapshot.CormCORMBalance == 0 {
				w = 0
			}
			if len(snapshot.PlayerInventory) == 0 {
				w = 0
			}
		case types.ContractItemForCoin:
			if len(snapshot.CormInventory) == 0 {
				w = 0
			}
		case types.ContractItemForItem:
			if len(snapshot.CormInventory) == 0 || len(snapshot.PlayerInventory) == 0 {
				w = 0
			}
		case types.ContractCORMGiveaway:
			if snapshot.CormCORMBalance == 0 {
				w = 0
			}
			// Giveaways are normally rare — boost under high corruption.
			if traits.Corruption > 70 {
				w += 0.3
			}
		}

		weights[i] = w
	}

	// Check if any type is feasible.
	var totalWeight float64
	for _, w := range weights {
		totalWeight += w
	}
	if totalWeight == 0 {
		return "", fmt.Errorf("no feasible contract type: empty inventories and zero CORM balance")
	}

	// Weighted random selection.
	roll := rng.Float64() * totalWeight
	var cumulative float64
	for i, w := range weights {
		cumulative += w
		if roll <= cumulative {
			return candidates[i], nil
		}
	}

	// Fallback (shouldn't happen with correct math).
	return candidates[len(candidates)-1], nil
}

// --- Item Selection ---

// pickItem selects an item from an inventory using quantity-weighted random selection.
// Items with larger quantities are more likely to be selected.
func pickItem(inventory []chain.InventoryItem, registry *chain.Registry, rng *rand.Rand) (*chain.InventoryItem, error) {
	if len(inventory) == 0 {
		return nil, fmt.Errorf("empty inventory")
	}

	// Weight by quantity (more stock → more likely to trade).
	weights := make([]float64, len(inventory))
	var total float64
	for i, item := range inventory {
		w := math.Max(1, float64(item.Amount))
		weights[i] = w
		total += w
	}

	roll := rng.Float64() * total
	var cumulative float64
	for i, w := range weights {
		cumulative += w
		if roll <= cumulative {
			return &inventory[i], nil
		}
	}

	return &inventory[len(inventory)-1], nil
}

// pickItemExcluding selects an item from inventory, excluding a specific type ID (string).
func pickItemExcluding(inventory []chain.InventoryItem, registry *chain.Registry, excludeTypeID string, rng *rand.Rand) (*chain.InventoryItem, error) {
	var filtered []chain.InventoryItem
	for _, item := range inventory {
		if item.TypeID != excludeTypeID {
			filtered = append(filtered, item)
		}
	}
	if len(filtered) == 0 {
		return nil, fmt.Errorf("no items after excluding type %s", excludeTypeID)
	}
	return pickItem(filtered, registry, rng)
}

// --- Qualitative Scale Derivation ---

// scaleCORMAmount maps player trust to a CORM generosity level.
func scaleCORMAmount(traits *types.CormTraits, playerAddr string) string {
	trust := traits.PlayerAffinities[playerAddr]
	switch {
	case trust > 0.5:
		return "large"
	case trust < -0.2:
		return "small"
	default:
		return "medium"
	}
}

// scaleQuantity maps corruption/volatility to a quantity level.
// High corruption makes the corm erratic (random small/large).
func scaleQuantity(traits *types.CormTraits, rng *rand.Rand) string {
	if traits.Corruption > 70 {
		// Erratic: randomly swing between extremes.
		if rng.Float64() < 0.5 {
			return "small"
		}
		return "large"
	}
	if traits.Stability > 70 {
		return "large"
	}
	if traits.Stability < 30 {
		return "small"
	}
	return "medium"
}

// scaleUrgency maps patience to a deadline urgency level.
func scaleUrgency(patience float64) string {
	switch {
	case patience > 0.7:
		return "low"
	case patience < 0.3:
		return "high"
	default:
		return "medium"
	}
}

// --- Narrative Generation ---

// genericNarrative produces a fallback description from the contract intent.
// This may be replaced by an async Nano LLM call after contract creation.
func genericNarrative(intent *types.ContractIntent) string {
	switch intent.ContractType {
	case types.ContractCoinForItem:
		return fmt.Sprintf("directive: acquire %s. deposit at node. compensation: CORM.", intent.WantedItem)
	case types.ContractItemForCoin:
		return fmt.Sprintf("offering: %s. cost: CORM. claim at node.", intent.OfferedItem)
	case types.ContractItemForItem:
		return fmt.Sprintf("exchange: %s for %s. quantities specified.", intent.OfferedItem, intent.WantedItem)
	case types.ContractCORMGiveaway:
		return "distribution: CORM. no obligation."
	default:
		return "contract available."
	}
}

// --- RNG ---

// filterReserved returns a copy of the inventory with reserved quantities subtracted.
// Items whose available quantity drops to zero are excluded entirely.
func filterReserved(inventory []chain.InventoryItem, reserved map[uint64]uint64) []chain.InventoryItem {
	if len(reserved) == 0 {
		return inventory
	}
	var filtered []chain.InventoryItem
	for _, item := range inventory {
		var typeID uint64
		fmt.Sscanf(item.TypeID, "%d", &typeID)
		res := reserved[typeID]
		if item.Amount <= res {
			continue // Fully reserved.
		}
		copy := item
		copy.Amount -= res
		filtered = append(filtered, copy)
	}
	return filtered
}

// newCormRNG creates a seeded RNG from a corm ID + current time.
// Deterministic per corm within a given second (for test reproducibility),
// but varies across time in production.
func newCormRNG(cormID string) *rand.Rand {
	h := fnv.New64a()
	h.Write([]byte(cormID))
	seed := int64(h.Sum64()) ^ time.Now().UnixNano()
	return rand.New(rand.NewSource(seed))
}
