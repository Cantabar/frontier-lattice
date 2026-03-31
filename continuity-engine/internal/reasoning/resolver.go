package reasoning

import (
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

// ErrNoSSU is returned when no valid SSU exists on the network node.
// Callers can use errors.Is to distinguish this from other resolution failures.
var ErrNoSSU = errors.New("no valid SSU on network node")

// zeroAddress is the 66-char Sui zero address used to detect placeholder values.
const zeroAddress = "0x0000000000000000000000000000000000000000000000000000000000000000"

// firstValidSSU returns the first SSU with a non-empty, non-zero ObjectID.
func firstValidSSU(ssus []chain.SSUInfo) (chain.SSUInfo, bool) {
	for _, ssu := range ssus {
		id := strings.TrimSpace(ssu.ObjectID)
		if id != "" && id != zeroAddress {
			return ssu, true
		}
	}
	return chain.SSUInfo{}, false
}

// HasValidSSU reports whether the snapshot contains at least one usable SSU.
func HasValidSSU(snapshot chain.WorldSnapshot) bool {
	_, ok := firstValidSSU(snapshot.NodeSSUs)
	return ok
}

// PricingConfig holds configurable pricing parameters.
type PricingConfig struct {
	CORMPerLUX       float64
	CORMFloorPerUnit uint64
}

// PlayerIdentity holds the identity fields needed for contract access restriction.
type PlayerIdentity struct {
	Address     string
	CharacterID string
	TribeID     uint32
}

// ResolveIntent maps a ContractIntent to exact on-chain ContractParams.
func ResolveIntent(
	intent types.ContractIntent,
	snapshot chain.WorldSnapshot,
	registry *chain.Registry,
	traits *types.CormTraits,
	pricing PricingConfig,
	player PlayerIdentity,
) (*chain.ContractParams, error) {
	if !types.ValidContractTypes[intent.ContractType] {
		return nil, fmt.Errorf("invalid contract type: %s", intent.ContractType)
	}

	var allowedTribes []uint32
	if player.TribeID > 0 {
		allowedTribes = []uint32{player.TribeID}
	}

	params := &chain.ContractParams{
		ContractType:      intent.ContractType,
		PlayerCharacterID: player.CharacterID,
		PlayerAddress:     player.Address,
		AllowPartial:      intent.AllowPartial,
		DeadlineMs:        resolveDeadline(intent.Urgency, traits.Patience),
		AllowedTribes:     allowedTribes,
	}

	// SSU selection: use first valid SSU on the node.
	// build_ssu intents are UI-only and don't need an SSU.
	if ssu, ok := firstValidSSU(snapshot.NodeSSUs); ok {
		params.SourceSSUID = ssu.ObjectID
		params.DestinationSSUID = ssu.ObjectID
	} else if intent.ContractType != types.ContractBuildSSU {
		return nil, ErrNoSSU
	}

	switch intent.ContractType {
	case types.ContractCoinForItem:
		// Corm pays CORM, wants items from the player
		wanted := registry.LookupByName(intent.WantedItem)
		if wanted == nil {
			return nil, fmt.Errorf("unknown item: %s", intent.WantedItem)
		}
		var qty uint64
		if intent.ExactQuantity > 0 {
			qty = intent.ExactQuantity
		} else {
			qty = resolveQuantity(intent.Quantity, playerInventoryQty(snapshot.PlayerInventory, wanted.TypeID))
		}
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
		var qty uint64
		if intent.ExactQuantity > 0 {
			qty = intent.ExactQuantity
		} else {
			qty = resolveQuantity(intent.Quantity, cormInventoryQty(snapshot.CormInventory, offered.TypeID))
		}
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
		var offeredQty uint64
		if intent.ExactQuantity > 0 {
			offeredQty = intent.ExactQuantity
		} else {
			offeredQty = resolveQuantity(intent.Quantity, cormInventoryQty(snapshot.CormInventory, offered.TypeID))
		}
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

	// CORM escrow must not exceed balance — skip when inline minting is
	// available because the PTB will mint the exact amount needed.
	if !snapshot.CanMintInline && params.CORMEscrowAmount > snapshot.CormCORMBalance {
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

// playerInventoryQty finds a specific item's quantity in an inventory.
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
