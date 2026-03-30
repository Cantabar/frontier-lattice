package chain

import (
	"context"
	"fmt"
	"log/slog"
)

// ContractParams holds parameters for creating a trustless contract on-chain.
// All coin types are Coin<CORM>.
type ContractParams struct {
	ContractType      string // coin_for_item, item_for_coin, item_for_item, corm_giveaway
	PlayerCharacterID string
	PlayerAddress     string
	OfferedTypeID     uint64 // for item_for_coin, item_for_item
	OfferedQuantity   uint32
	WantedTypeID      uint64 // for coin_for_item, item_for_item
	WantedQuantity    uint32
	CORMEscrowAmount  uint64 // for coin_for_item, corm_giveaway
	CORMWantedAmount  uint64 // for item_for_coin
	SourceSSUID       string
	DestinationSSUID  string
	AllowPartial      bool
	DeadlineMs        int64
}

// CreateContract creates a trustless contract on-chain.
// Routes to the appropriate Move module based on ContractType.
// TODO: Implement via PTB calling the appropriate trustless_contracts module.
func (c *Client) CreateContract(ctx context.Context, cormID string, params ContractParams) (string, error) {
	if !c.HasSigner() {
		return "", fmt.Errorf("no signer configured")
	}

	prefix := cormID
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}
	contractID := fmt.Sprintf("contract_%s_%s", prefix, params.ContractType)

	switch params.ContractType {
	case "coin_for_item":
		slog.Info(fmt.Sprintf("chain: stub CreateCoinForItem %s escrow=%d wanted_type=%d wanted_qty=%d player=%s",
			contractID, params.CORMEscrowAmount, params.WantedTypeID, params.WantedQuantity, params.PlayerAddress))
	case "item_for_coin":
		slog.Info(fmt.Sprintf("chain: stub CreateItemForCoin %s offered_type=%d offered_qty=%d wanted_corm=%d player=%s",
			contractID, params.OfferedTypeID, params.OfferedQuantity, params.CORMWantedAmount, params.PlayerAddress))
	case "item_for_item":
		slog.Info(fmt.Sprintf("chain: stub CreateItemForItem %s offered_type=%d offered_qty=%d wanted_type=%d wanted_qty=%d player=%s",
			contractID, params.OfferedTypeID, params.OfferedQuantity, params.WantedTypeID, params.WantedQuantity, params.PlayerAddress))
	case "corm_giveaway":
		slog.Info(fmt.Sprintf("chain: stub CreateCORMGiveaway %s escrow=%d player=%s",
			contractID, params.CORMEscrowAmount, params.PlayerAddress))
	default:
		slog.Info(fmt.Sprintf("chain: stub CreateContract %s type=%s player=%s", contractID, params.ContractType, params.PlayerAddress))
	}

	return contractID, nil
}
