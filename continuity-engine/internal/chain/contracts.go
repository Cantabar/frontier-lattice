package chain

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pattonkan/sui-go/sui"
	"github.com/pattonkan/sui-go/sui/suiptb"
	"github.com/pattonkan/sui-go/suiclient"
)

// ContractParams holds parameters for creating a trustless contract on-chain.
// All coin types are Coin<CORM_COIN>.
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
func (c *Client) CreateContract(ctx context.Context, cormID string, params ContractParams) (string, error) {
	if !c.HasSigner() {
		return "", fmt.Errorf("no signer configured")
	}

	// Fall back to stub if required package IDs or object IDs are missing
	if c.trustlessContractsPkg == nil || c.cormStatePkg == nil || c.cormCharacterID == nil {
		return c.createContractStub(cormID, params)
	}

	switch params.ContractType {
	case "coin_for_item":
		return c.createCoinForItem(ctx, cormID, params)
	case "item_for_coin":
		// item_for_coin requires withdrawing items from SSU — needs CormAuth extension.
		// Stub until SSU interaction is wired.
		return c.createContractStub(cormID, params)
	case "item_for_item":
		// item_for_item requires withdrawing items from SSU — needs CormAuth extension.
		return c.createContractStub(cormID, params)
	case "corm_giveaway":
		// corm_giveaway is coin_for_item with wanted_amount=0 (item_for_coin where items are free).
		// Implemented as item_for_coin::create with wanted_amount=0.
		return c.createContractStub(cormID, params)
	default:
		return c.createContractStub(cormID, params)
	}
}

// createCoinForItem creates a CoinForItem<CORM_COIN> contract on-chain.
// The corm locks CORM as escrow, wanting items deposited by the player.
func (c *Client) createCoinForItem(ctx context.Context, cormID string, params ContractParams) (string, error) {
	// Build the CORM_COIN type tag for the generic <C> parameter
	cormCoinTypeTag := sui.TypeTag{
		Struct: &sui.StructTag{
			Address:    sui.MustAddressFromHex(c.cormStatePkg.String()),
			Module:     "corm_coin",
			Name:       "CORM_COIN",
			TypeParams: []sui.TypeTag{},
		},
	}

	destSSU, err := sui.ObjectIdFromHex(params.DestinationSSUID)
	if err != nil {
		return "", fmt.Errorf("invalid destination SSU: %w", err)
	}

	// Resolve the brain's Character object
	charRef, err := c.getOwnedObjectRef(ctx, c.cormCharacterID)
	if err != nil {
		return "", fmt.Errorf("get Character ref: %w", err)
	}

	// Build PTB
	ptb := suiptb.NewTransactionDataTransactionBuilder()

	// Split escrow CORM from gas coin (the brain's CORM holdings)
	// First, find a CORM coin owned by the signer
	cormCoinRef, err := c.findOwnedCoin(ctx, c.CORMCoinType(), params.CORMEscrowAmount)
	if err != nil {
		return "", fmt.Errorf("find CORM coin for escrow: %w", err)
	}

	coinArg := ptb.MustObj(suiptb.ObjectArg{ImmOrOwnedObject: cormCoinRef})
	escrowAmountArg := ptb.MustPure(params.CORMEscrowAmount)
	splitResult := ptb.Command(suiptb.Command{
		SplitCoins: &suiptb.ProgrammableSplitCoins{
			Coin:    coinArg,
			Amounts: []suiptb.Argument{escrowAmountArg},
		},
	})

	// character (immutable ref)
	charArg := ptb.MustObj(suiptb.ObjectArg{ImmOrOwnedObject: charRef})

	// Build allowed_characters vector
	allowedChars := []sui.ObjectId{}
	if params.PlayerCharacterID != "" {
		pCharID, err := sui.ObjectIdFromHex(params.PlayerCharacterID)
		if err == nil {
			allowedChars = append(allowedChars, *pCharID)
		}
	}

	// Arguments for coin_for_item::create<CORM_COIN>
	wantedTypeArg := ptb.MustPure(params.WantedTypeID)
	wantedQtyArg := ptb.MustPure(params.WantedQuantity)
	destSSUArg := ptb.MustPure(destSSU)
	allowPartialArg := ptb.MustPure(params.AllowPartial)
	useOwnerInvArg := ptb.MustPure(false) // deposit to poster's player inventory
	deadlineArg := ptb.MustPure(uint64(params.DeadlineMs))
	allowedCharsArg := ptb.MustPure(allowedChars)
	allowedTribesArg := ptb.MustPure([]uint32{}) // no tribe restriction

	// Clock (shared, immutable)
	clockArg := ptb.MustObj(suiptb.ObjectArg{
		SharedObject: &suiptb.SharedObjectArg{
			Id:                   SuiClockObjectID,
			InitialSharedVersion: sui.SequenceNumber(1),
			Mutable:              false,
		},
	})

	ptb.ProgrammableMoveCall(
		c.trustlessContractsPkg,
		"coin_for_item",
		"create",
		[]sui.TypeTag{cormCoinTypeTag},
		[]suiptb.Argument{
			charArg,
			splitResult, // escrow_coin (the split-off Coin<CORM_COIN>)
			wantedTypeArg,
			wantedQtyArg,
			destSSUArg,
			allowPartialArg,
			useOwnerInvArg,
			deadlineArg,
			allowedCharsArg,
			allowedTribesArg,
			clockArg,
		},
	)

	resp, err := c.signAndExecute(ctx, ptb)
	if err != nil {
		return "", fmt.Errorf("execute coin_for_item::create: %w", err)
	}

	// Extract contract object ID from ObjectChanges
	contractID := ""
	for _, change := range resp.ObjectChanges {
		if change.Data.Created != nil {
			if containsStr(string(change.Data.Created.ObjectType), "coin_for_item::CoinForItemContract") {
				contractID = change.Data.Created.ObjectId.String()
				break
			}
		}
	}

	if contractID == "" {
		return "", fmt.Errorf("contract object not found in transaction effects")
	}

	slog.Info(fmt.Sprintf("chain: CreateCoinForItem %s escrow=%d wanted_type=%d wanted_qty=%d player=%s",
		contractID, params.CORMEscrowAmount, params.WantedTypeID, params.WantedQuantity, params.PlayerAddress))
	return contractID, nil
}

// findOwnedCoin finds a Coin of the given type owned by the signer with
// at least `minBalance` value. Returns the ObjectRef for use in PTB.
func (c *Client) findOwnedCoin(ctx context.Context, coinType string, minBalance uint64) (*sui.ObjectRef, error) {
	objType := sui.ObjectType(coinType)
	resp, err := c.rpc.GetCoins(ctx, &suiclient.GetCoinsRequest{
		Owner:    c.signer.Address(),
		CoinType: &objType,
		Limit:    10,
	})
	if err != nil {
		return nil, fmt.Errorf("get coins: %w", err)
	}

	for _, coin := range resp.Data {
		if coin.Balance.Uint64() >= minBalance {
			return coin.Ref(), nil
		}
	}

	return nil, fmt.Errorf("no %s coin with balance >= %d", coinType, minBalance)
}

// getOwnedObjectRef fetches an owned object's ref by ID.
func (c *Client) getOwnedObjectRef(ctx context.Context, objID *sui.ObjectId) (*sui.ObjectRef, error) {
	data, err := c.getSharedObjectRef(ctx, objID)
	if err != nil {
		return nil, err
	}
	return data.Ref(), nil
}

// createContractStub logs and returns a placeholder contract ID.
// Used when required config is missing or for unimplemented contract types.
func (c *Client) createContractStub(cormID string, params ContractParams) (string, error) {
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
