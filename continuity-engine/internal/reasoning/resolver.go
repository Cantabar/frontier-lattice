package reasoning

import (
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

// PricingConfig holds configurable pricing parameters.
type PricingConfig struct {
	CORMPerLUX       float64
	CORMFloorPerUnit uint64
}

// ResolveIntent maps a ContractIntent to exact on-chain ContractParams.
func ResolveIntent(
	intent types.ContractIntent,
	snapshot chain.WorldSnapshot,
	registry *chain.Registry,
	traits *types.CormTraits,
	pricing PricingConfig,
	playerAddr string,
) (*chain.ContractParams, error) {
	if !types.ValidContractTypes[intent.ContractType] {
		return nil, fmt.Errorf("invalid contract type: %s", intent.ContractType)
	}

	params := &chain.ContractParams{
		ContractType:  intent.ContractType,
		PlayerAddress: playerAddr,
		AllowPartial:  intent.AllowPartial,
		DeadlineMs:    resolveDeadline(intent.Urgency, traits.Patience),
	}

	// SSU selection: use first available SSU on the node
	if len(snapshot.NodeSSUs) > 0 {
		params.SourceSSUID = snapshot.NodeSSUs[0].ObjectID
		params.DestinationSSUID = snapshot.NodeSSUs[0].ObjectID
	}

	switch intent.ContractType {
	case types.ContractCoinForItem:
		// Corm pays CORM, wants items from the player
		wanted := registry.LookupByName(intent.WantedItem)
		if wanted == nil {
			return nil, fmt.Errorf("unknown item: %s", intent.WantedItem)
		}
		qty := resolveQuantity(intent.Quantity, playerInventoryQty(snapshot.PlayerInventory, wanted.TypeID))
		if qty == 0 {
			qty = 10 // minimum
		}
		params.WantedTypeID = wanted.TypeID
		params.WantedQuantity = uint32(qty)
		params.CORMEscrowAmount = computeCORMAmount(wanted.LUXValue, qty, intent.CORMAmount, traits, pricing)

	case types.ContractItemForCoin:
		// Corm offers items, wants CORM from the player
		offered := registry.LookupByName(intent.OfferedItem)
		if offered == nil {
			return nil, fmt.Errorf("unknown item: %s", intent.OfferedItem)
		}
		qty := resolveQuantity(intent.Quantity, cormInventoryQty(snapshot.CormInventory, offered.TypeID))
		if qty == 0 {
			qty = 10
		}
		params.OfferedTypeID = offered.TypeID
		params.OfferedQuantity = uint32(qty)
		params.CORMWantedAmount = computeCORMAmount(offered.LUXValue, qty, intent.CORMAmount, traits, pricing)

	case types.ContractItemForItem:
		// Corm offers items, wants different items
		offered := registry.LookupByName(intent.OfferedItem)
		if offered == nil {
			return nil, fmt.Errorf("unknown offered item: %s", intent.OfferedItem)
		}
		wanted := registry.LookupByName(intent.WantedItem)
		if wanted == nil {
			return nil, fmt.Errorf("unknown wanted item: %s", intent.WantedItem)
		}
		offeredQty := resolveQuantity(intent.Quantity, cormInventoryQty(snapshot.CormInventory, offered.TypeID))
		if offeredQty == 0 {
			offeredQty = 10
		}
		// Scale wanted quantity by relative LUX value
		wantedQty := offeredQty
		if offered.LUXValue > 0 && wanted.LUXValue > 0 {
			wantedQty = uint64(math.Max(1, float64(offeredQty)*offered.LUXValue/wanted.LUXValue))
		}
		params.OfferedTypeID = offered.TypeID
		params.OfferedQuantity = uint32(offeredQty)
		params.WantedTypeID = wanted.TypeID
		params.WantedQuantity = uint32(wantedQty)

	case types.ContractCORMGiveaway:
		// Corm distributes CORM for free (wanted_amount = 0)
		amount := resolveGiveawayAmount(intent.CORMAmount, snapshot.CormCORMBalance, traits)
		if amount == 0 {
			return nil, fmt.Errorf("insufficient CORM balance for giveaway")
		}
		params.CORMEscrowAmount = amount
	}

	return params, nil
}

// ValidateParams checks hard constraints and attempts silent fixes.
// Returns nil if the params are valid (possibly after correction).
func ValidateParams(params *chain.ContractParams, snapshot chain.WorldSnapshot, registry *chain.Registry) error {
	// Active contract cap
	if snapshot.ActiveContracts >= 5 {
		return fmt.Errorf("contract cap reached (%d/5)", snapshot.ActiveContracts)
	}

	// Deadline must be in the future
	if params.DeadlineMs <= time.Now().UnixMilli() {
		params.DeadlineMs = time.Now().Add(12 * time.Hour).UnixMilli()
		slog.Info(fmt.Sprintf("resolver: corrected deadline to +12h"))
	}

	// CORM escrow must not exceed balance
	if params.CORMEscrowAmount > snapshot.CormCORMBalance {
		if snapshot.CormCORMBalance == 0 {
			return fmt.Errorf("corm has no CORM balance")
		}
		params.CORMEscrowAmount = snapshot.CormCORMBalance
		slog.Info(fmt.Sprintf("resolver: clamped escrow to CORM balance %d", params.CORMEscrowAmount))
	}

	// Validate item type IDs exist
	if params.WantedTypeID != 0 && registry.LookupByID(params.WantedTypeID) == nil {
		return fmt.Errorf("wanted type ID %d not in registry", params.WantedTypeID)
	}
	if params.OfferedTypeID != 0 && registry.LookupByID(params.OfferedTypeID) == nil {
		return fmt.Errorf("offered type ID %d not in registry", params.OfferedTypeID)
	}

	// Quantities must be > 0
	if params.WantedQuantity == 0 && params.CORMEscrowAmount == 0 && params.OfferedQuantity == 0 {
		return fmt.Errorf("contract has no quantities")
	}

	// Divisibility: escrow % quantity == 0 for partial-fill contracts
	if params.AllowPartial && params.CORMEscrowAmount > 0 && params.WantedQuantity > 0 {
		qty := uint64(params.WantedQuantity)
		if params.CORMEscrowAmount%qty != 0 {
			// Round down to nearest divisible amount
			params.CORMEscrowAmount = (params.CORMEscrowAmount / qty) * qty
			if params.CORMEscrowAmount == 0 {
				params.CORMEscrowAmount = qty // minimum 1 CORM per unit
			}
			slog.Info(fmt.Sprintf("resolver: adjusted escrow for divisibility: %d", params.CORMEscrowAmount))
		}
	}

	return nil
}

// computeCORMAmount derives a CORM amount from the item's LUX value.
func computeCORMAmount(luxValue float64, quantity uint64, scaleHint string, traits *types.CormTraits, pricing PricingConfig) uint64 {
	// Base: LUX value × quantity × exchange rate
	var perUnit float64
	if luxValue > 0 {
		perUnit = luxValue * pricing.CORMPerLUX
	} else {
		perUnit = float64(pricing.CORMFloorPerUnit)
	}

	base := perUnit * float64(quantity)

	// Scale hint multiplier
	multiplier := 1.0
	switch scaleHint {
	case "small":
		multiplier = 0.5
	case "large":
		multiplier = 1.5
	}
	base *= multiplier

	// Pattern alignment bonus (up to 1.5× for strongly aligned contract types)
	if traits != nil && len(traits.ContractTypeAffinity) > 0 {
		// Find max affinity — the more aligned, the more generous
		var maxAffinity float64
		for _, v := range traits.ContractTypeAffinity {
			if v > maxAffinity {
				maxAffinity = v
			}
		}
		if maxAffinity > 0 {
			base *= 1.0 + math.Min(maxAffinity, 1.0)*0.5
		}
	}

	// Corruption penalty: high corruption reduces generosity
	if traits != nil && traits.Corruption > 50 {
		penalty := (traits.Corruption - 50) / 200 // max 25% reduction at corruption=100
		base *= (1.0 - penalty)
	}

	amount := uint64(math.Max(1, math.Round(base)))
	return amount
}

// resolveQuantity maps a qualitative scale to a concrete quantity.
func resolveQuantity(scale string, available uint64) uint64 {
	if available == 0 {
		return 0
	}

	var fraction float64
	switch scale {
	case "small":
		fraction = 0.15
	case "large":
		fraction = 0.70
	default: // "medium"
		fraction = 0.40
	}

	qty := uint64(math.Max(1, math.Round(float64(available)*fraction)))
	if qty > available {
		qty = available
	}
	return qty
}

// resolveDeadline maps urgency to a deadline timestamp.
func resolveDeadline(urgency string, patience float64) int64 {
	var base time.Duration
	switch urgency {
	case "high":
		base = 4 * time.Hour
	case "low":
		base = 24 * time.Hour
	default: // "medium"
		base = 12 * time.Hour
	}

	// Patience modifier: higher patience → longer deadlines (up to 1.5×)
	modifier := 1.0 + patience*0.5
	deadline := time.Now().Add(time.Duration(float64(base) * modifier))
	return deadline.UnixMilli()
}

// resolveGiveawayAmount picks a CORM giveaway amount based on balance.
func resolveGiveawayAmount(scale string, balance uint64, traits *types.CormTraits) uint64 {
	if balance == 0 {
		return 0
	}

	var fraction float64
	switch scale {
	case "small":
		fraction = 0.05
	case "large":
		fraction = 0.20
	default:
		fraction = 0.10
	}

	amount := uint64(math.Max(1, math.Round(float64(balance)*fraction)))
	if amount > balance {
		amount = balance
	}
	return amount
}

// playerInventoryQty finds a specific item's quantity in the player's inventory.
func playerInventoryQty(inv []chain.InventoryItem, typeID uint64) uint64 {
	for _, item := range inv {
		// InventoryItem.TypeID is a string — compare as string
		if item.TypeID == fmt.Sprintf("%d", typeID) {
			return item.Amount
		}
	}
	return 0
}

// cormInventoryQty finds a specific item's quantity in the corm's inventory.
func cormInventoryQty(inv []chain.InventoryItem, typeID uint64) uint64 {
	return playerInventoryQty(inv, typeID) // same structure
}
