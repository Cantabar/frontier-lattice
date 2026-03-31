package chain

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pattonkan/sui-go/sui"
	"github.com/pattonkan/sui-go/sui/suiptb"
	"github.com/pattonkan/sui-go/suiclient"
)

// ContractParams holds parameters for creating a trustless contract on-chain.
// All coin types are Coin<CORM_COIN>.
type ContractParams struct {
	ContractType      string // coin_for_item, item_for_coin, item_for_item
	PlayerCharacterID string
	PlayerAddress     string
	OfferedTypeID     uint64 // for item_for_coin, item_for_item
	OfferedQuantity   uint32
	WantedTypeID      uint64 // for coin_for_item, item_for_item
	WantedQuantity    uint32
	CORMEscrowAmount  uint64 // for coin_for_item
	CORMWantedAmount  uint64 // for item_for_coin
	SourceSSUID       string
	DestinationSSUID  string
	AllowPartial      bool
	DeadlineMs        int64
	AllowedTribes     []uint32 // in-game tribe IDs allowed to fill (empty = no tribe restriction)
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
	case "coin_for_coin":
		return c.createCoinForCoin(ctx, cormID, params)
	case "item_for_coin":
		if !c.CanCreateItemContracts() {
			return c.createContractStub(cormID, params)
		}
		return c.createItemForCoin(ctx, cormID, params)
	case "item_for_item":
		if !c.CanCreateItemContracts() {
			return c.createContractStub(cormID, params)
		}
		return c.createItemForItem(ctx, cormID, params)
	default:
		return c.createContractStub(cormID, params)
	}
}

// --- Shared PTB helpers ---

// cormCoinTypeTag returns the TypeTag for the CORM_COIN generic parameter.
// Uses original-id — struct types are anchored at first publish, not published-at.
func (c *Client) cormCoinTypeTag() sui.TypeTag {
	typePkg := c.cormStateTypePkg()
	return sui.TypeTag{
		Struct: &sui.StructTag{
			Address:    sui.MustAddressFromHex(typePkg.String()),
			Module:     "corm_coin",
			Name:       "CORM_COIN",
			TypeParams: []sui.TypeTag{},
		},
	}
}

// characterArg resolves the brain's Character as a shared object PTB argument.
// Character objects in Eve Frontier are shared objects (required because
// fill() lets a filler reference the poster's Character in a separate tx).
func (c *Client) characterArg(ctx context.Context, ptb *suiptb.ProgrammableTransactionBuilder, mutable bool) (suiptb.Argument, error) {
	charData, err := c.getSharedObjectRef(ctx, c.cormCharacterID)
	if err != nil {
		return suiptb.Argument{}, fmt.Errorf("get Character ref: %w", err)
	}
	return ptb.MustObj(suiptb.ObjectArg{
		SharedObject: charData.SharedObjectArg(mutable),
	}), nil
}

// clockArg returns the SUI Clock as an immutable shared object PTB argument.
func clockArg(ptb *suiptb.ProgrammableTransactionBuilder) suiptb.Argument {
	return ptb.MustObj(suiptb.ObjectArg{
		SharedObject: &suiptb.SharedObjectArg{
			Id:                   SuiClockObjectID,
			InitialSharedVersion: sui.SequenceNumber(1),
			Mutable:              false,
		},
	})
}

// splitCORMCoin finds a CORM coin and splits the requested amount in the PTB.
// If no owned coin with sufficient balance exists, mints the exact amount
// inline via corm_coin::mint_coin and returns it directly (no split needed).
// Returns the coin argument ready for use as escrow.
func (c *Client) splitCORMCoin(ctx context.Context, ptb *suiptb.ProgrammableTransactionBuilder, cormID string, amount uint64) (suiptb.Argument, error) {
	cormCoinRef, err := c.findOwnedCoin(ctx, c.CORMCoinType(), amount)
	if err == nil {
		// Found an existing coin with sufficient balance — split from it.
		coinArg := ptb.MustObj(suiptb.ObjectArg{ImmOrOwnedObject: cormCoinRef})
		amountArg := ptb.MustPure(amount)
		return ptb.Command(suiptb.Command{
			SplitCoins: &suiptb.ProgrammableSplitCoins{
				Coin:    coinArg,
				Amounts: []suiptb.Argument{amountArg},
			},
		}), nil
	}

	// No sufficient coin — mint the exact amount inline in this PTB.
	slog.Info(fmt.Sprintf("chain: no CORM coin >= %d, minting inline for corm %s", amount, cormID))
	return c.mintCORMCoinArg(ctx, ptb, cormID, amount)
}

// allowedCharsArg builds the allowed_characters vector<ID> PTB argument.
func allowedCharsArg(ptb *suiptb.ProgrammableTransactionBuilder, playerCharacterID string) suiptb.Argument {
	allowedChars := []sui.ObjectId{}
	if playerCharacterID != "" {
		pCharID, err := sui.ObjectIdFromHex(playerCharacterID)
		if err == nil {
			allowedChars = append(allowedChars, *pCharID)
		}
	}
	return ptb.MustPure(allowedChars)
}

// allowedTribesArg builds the allowed_tribes vector<u32> PTB argument.
func allowedTribesArg(ptb *suiptb.ProgrammableTransactionBuilder, tribes []uint32) suiptb.Argument {
	if tribes == nil {
		tribes = []uint32{}
	}
	return ptb.MustPure(tribes)
}

// extractCreatedContract finds a contract object ID from transaction ObjectChanges.
func extractCreatedContract(resp *suiclient.SuiTransactionBlockResponse, typeSubstring string) string {
	for _, change := range resp.ObjectChanges {
		if change.Data.Created != nil {
			if containsStr(string(change.Data.Created.ObjectType), typeSubstring) {
				return change.Data.Created.ObjectId.String()
			}
		}
	}
	return ""
}

// --- Batch Contract Creation ---

// CreateContracts creates multiple trustless contracts in a single PTB.
// This minimizes RPC round-trips and gas costs by batching all create calls
// into one Sui transaction. Returns a contract ID for each params entry
// (positionally matched). If only one params is provided, delegates to the
// single-contract path for zero behavioral change.
func (c *Client) CreateContracts(ctx context.Context, cormID string, paramsList []ContractParams) ([]string, error) {
	if len(paramsList) == 0 {
		return nil, nil
	}
	if len(paramsList) == 1 {
		id, err := c.CreateContract(ctx, cormID, paramsList[0])
		if err != nil {
			return nil, err
		}
		return []string{id}, nil
	}

	if !c.HasSigner() {
		return nil, fmt.Errorf("no signer configured")
	}

	// Fall back to stubs if required config is missing.
	if c.trustlessContractsPkg == nil || c.cormStatePkg == nil || c.cormCharacterID == nil {
		return c.createContractsStub(cormID, paramsList)
	}

	// Classify contracts by type.
	needsItemCap := false
	var totalEscrow uint64
	escrowAmounts := make([]uint64, 0) // per-coin-based contract
	escrowIndices := make([]int, 0)    // original index in paramsList
	itemIndices := make([]int, 0)      // original indices for item-based contracts
	for i, p := range paramsList {
		switch p.ContractType {
		case "coin_for_item":
			escrowAmounts = append(escrowAmounts, p.CORMEscrowAmount)
			escrowIndices = append(escrowIndices, i)
			totalEscrow += p.CORMEscrowAmount
		case "coin_for_coin":
			escrowAmounts = append(escrowAmounts, p.CORMEscrowAmount)
			escrowIndices = append(escrowIndices, i)
			totalEscrow += p.CORMEscrowAmount
		case "item_for_coin", "item_for_item":
			if !c.CanCreateItemContracts() {
				return nil, fmt.Errorf("item contracts not configured")
			}
			needsItemCap = true
			itemIndices = append(itemIndices, i)
		}
	}

	// --- Resolve shared objects once ---
	ptb := suiptb.NewTransactionDataTransactionBuilder()

	charData, err := c.getSharedObjectRef(ctx, c.cormCharacterID)
	if err != nil {
		return nil, fmt.Errorf("get Character ref: %w", err)
	}
	// Mutable character needed if any item-based contracts exist.
	charArg := ptb.MustObj(suiptb.ObjectArg{SharedObject: charData.SharedObjectArg(needsItemCap)})
	clkArg := clockArg(ptb)

	// --- CORM coin split (all escrow amounts at once) ---
	escrowArgs := make(map[int]suiptb.Argument) // paramsList index → split coin arg
	if len(escrowAmounts) > 0 {
		// Try to find an existing coin, fall back to minting inline.
		var coinArg suiptb.Argument
		cormCoinRef, err := c.findOwnedCoin(ctx, c.CORMCoinType(), totalEscrow)
		if err == nil {
			coinArg = ptb.MustObj(suiptb.ObjectArg{ImmOrOwnedObject: cormCoinRef})
		} else {
			slog.Info(fmt.Sprintf("chain: no CORM coin >= %d for batch, minting inline for corm %s", totalEscrow, cormID))
			mintedCoin, mintErr := c.mintCORMCoinArg(ctx, ptb, cormID, totalEscrow)
			if mintErr != nil {
				return nil, fmt.Errorf("mint CORM for batch escrow: %w", mintErr)
			}
			coinArg = mintedCoin
		}

		amountArgs := make([]suiptb.Argument, len(escrowAmounts))
		for i, amt := range escrowAmounts {
			amountArgs[i] = ptb.MustPure(amt)
		}
		splitResult := ptb.Command(suiptb.Command{
			SplitCoins: &suiptb.ProgrammableSplitCoins{
				Coin:    coinArg,
				Amounts: amountArgs,
			},
		})
		splitCmdIdx := *splitResult.Result
		for i, origIdx := range escrowIndices {
			escrowArgs[origIdx] = suiptb.Argument{
				NestedResult: &suiptb.NestedResult{Cmd: splitCmdIdx, Result: uint16(i)},
			}
		}
	}

	// --- Item withdrawals (single borrow/return cycle) ---
	itemArgs := make(map[int]suiptb.Argument) // paramsList index → withdrawn item arg
	var ssuArg suiptb.Argument

	if needsItemCap && len(itemIndices) > 0 {
		// All item contracts use the same source SSU (guaranteed by resolver).
		firstItemParams := paramsList[itemIndices[0]]
		sourceSSU, err := sui.ObjectIdFromHex(firstItemParams.SourceSSUID)
		if err != nil {
			return nil, fmt.Errorf("invalid source SSU: %w", err)
		}

		ownerCapRef, err := c.findOwnerCapForSSU(ctx, sourceSSU)
		if err != nil {
			return nil, fmt.Errorf("find OwnerCap for SSU %s: %w", firstItemParams.SourceSSUID, err)
		}

		ssuData, err := c.getSharedObjectRef(ctx, sourceSSU)
		if err != nil {
			return nil, fmt.Errorf("get SSU ref: %w", err)
		}
		ssuArg = ptb.MustObj(suiptb.ObjectArg{SharedObject: ssuData.SharedObjectArg(true)})

		// Step 1: borrow_owner_cap (once)
		ownerCapReceivingArg := ptb.MustObj(suiptb.ObjectArg{Receiving: ownerCapRef})
		storageUnitTypeTag := c.storageUnitTypeTag()
		borrowResult := ptb.Command(suiptb.Command{
			MoveCall: &suiptb.ProgrammableMoveCall{
				Package:       c.worldPkg,
				Module:        "character",
				Function:      "borrow_owner_cap",
				TypeArguments: []sui.TypeTag{storageUnitTypeTag},
				Arguments:     []suiptb.Argument{charArg, ownerCapReceivingArg},
			},
		})
		borrowCmdIdx := *borrowResult.Result
		ownerCapArg := suiptb.Argument{NestedResult: &suiptb.NestedResult{Cmd: borrowCmdIdx, Result: 0}}
		receiptArg := suiptb.Argument{NestedResult: &suiptb.NestedResult{Cmd: borrowCmdIdx, Result: 1}}

		// Step 2: withdraw_by_owner for each item contract
		for _, idx := range itemIndices {
			p := paramsList[idx]
			withdrawResult := ptb.Command(suiptb.Command{
				MoveCall: &suiptb.ProgrammableMoveCall{
					Package:       c.worldPkg,
					Module:        "storage_unit",
					Function:      "withdraw_by_owner",
					TypeArguments: []sui.TypeTag{},
					Arguments: []suiptb.Argument{
						ssuArg,
						charArg,
						ownerCapArg,
						ptb.MustPure(p.OfferedTypeID),
						ptb.MustPure(p.OfferedQuantity),
					},
				},
			})
			itemArgs[idx] = withdrawResult
		}

		// Step 3: return_owner_cap (once, after all withdrawals)
		ptb.Command(suiptb.Command{
			MoveCall: &suiptb.ProgrammableMoveCall{
				Package:       c.worldPkg,
				Module:        "character",
				Function:      "return_owner_cap",
				TypeArguments: []sui.TypeTag{storageUnitTypeTag},
				Arguments:     []suiptb.Argument{charArg, ownerCapArg, receiptArg},
			},
		})
	}

	// --- Create calls (one per contract, in paramsList order) ---
	// Track type substrings in order for extractCreatedContracts.
	typeSubstrings := make([]string, len(paramsList))

	for i, p := range paramsList {
		switch p.ContractType {
		case "coin_for_item":
			destSSU, err := sui.ObjectIdFromHex(p.DestinationSSUID)
			if err != nil {
				return nil, fmt.Errorf("invalid destination SSU for contract %d: %w", i, err)
			}
			ptb.ProgrammableMoveCall(
				c.trustlessContractsPkg,
				"coin_for_item",
				"create",
				[]sui.TypeTag{c.cormCoinTypeTag()},
				[]suiptb.Argument{
					charArg,
					escrowArgs[i],
					ptb.MustPure(p.WantedTypeID),
					ptb.MustPure(p.WantedQuantity),
					ptb.MustPure(destSSU),
					ptb.MustPure(p.AllowPartial),
					ptb.MustPure(false),
					ptb.MustPure(uint64(p.DeadlineMs)),
					allowedCharsArg(ptb, p.PlayerCharacterID),
					allowedTribesArg(ptb, p.AllowedTribes),
					clkArg,
				},
			)
			typeSubstrings[i] = "coin_for_item::CoinForItemContract"

		case "coin_for_coin":
			cormTag := c.cormCoinTypeTag()
			ptb.ProgrammableMoveCall(
				c.trustlessContractsPkg,
				"coin_for_coin",
				"create",
				[]sui.TypeTag{cormTag, cormTag},
				[]suiptb.Argument{
					charArg,
					escrowArgs[i],
					ptb.MustPure(p.CORMWantedAmount),
					ptb.MustPure(p.AllowPartial),
					ptb.MustPure(uint64(p.DeadlineMs)),
					allowedCharsArg(ptb, p.PlayerCharacterID),
					allowedTribesArg(ptb, p.AllowedTribes),
					clkArg,
				},
			)
			typeSubstrings[i] = "coin_for_coin::CoinForCoinContract"

		case "item_for_coin":
			ptb.ProgrammableMoveCall(
				c.trustlessContractsPkg,
				"item_for_coin",
				"create",
				[]sui.TypeTag{c.cormCoinTypeTag()},
				[]suiptb.Argument{
					charArg,
					ssuArg,
					itemArgs[i],
					ptb.MustPure(p.CORMWantedAmount),
					ptb.MustPure(p.AllowPartial),
					ptb.MustPure(uint64(p.DeadlineMs)),
					allowedCharsArg(ptb, p.PlayerCharacterID),
					allowedTribesArg(ptb, p.AllowedTribes),
					clkArg,
				},
			)
			typeSubstrings[i] = "item_for_coin::ItemForCoinContract"

		case "item_for_item":
			destSSU, err := sui.ObjectIdFromHex(p.DestinationSSUID)
			if err != nil {
				return nil, fmt.Errorf("invalid destination SSU for contract %d: %w", i, err)
			}
			// Resolve destination SSU shared object for item_for_item if different from source.
			// The ssuArg already covers the source SSU for create calls.
			ptb.ProgrammableMoveCall(
				c.trustlessContractsPkg,
				"item_for_item",
				"create",
				[]sui.TypeTag{},
				[]suiptb.Argument{
					charArg,
					ssuArg,
					itemArgs[i],
					ptb.MustPure(p.WantedTypeID),
					ptb.MustPure(p.WantedQuantity),
					ptb.MustPure(destSSU),
					ptb.MustPure(p.AllowPartial),
					ptb.MustPure(false),
					ptb.MustPure(uint64(p.DeadlineMs)),
					allowedCharsArg(ptb, p.PlayerCharacterID),
					allowedTribesArg(ptb, p.AllowedTribes),
					clkArg,
				},
			)
			typeSubstrings[i] = "item_for_item::ItemForItemContract"
		}
	}

	// --- Execute single transaction ---
	resp, err := c.signAndExecute(ctx, ptb)
	if err != nil {
		return nil, fmt.Errorf("execute batch contract create: %w", err)
	}

	// --- Extract created contract IDs ---
	contractIDs := extractCreatedContracts(resp, typeSubstrings)

	for i, id := range contractIDs {
		if id == "" {
			slog.Warn(fmt.Sprintf("chain: batch contract %d (%s) not found in tx effects", i, paramsList[i].ContractType))
		}
	}

	slog.Info(fmt.Sprintf("chain: CreateContracts batch of %d in single PTB for corm %s", len(paramsList), cormID))
	return contractIDs, nil
}

// createContractsStub returns stub contract IDs for each params entry.
func (c *Client) createContractsStub(cormID string, paramsList []ContractParams) ([]string, error) {
	ids := make([]string, len(paramsList))
	for i, p := range paramsList {
		id, err := c.createContractStub(cormID, p)
		if err != nil {
			return nil, err
		}
		ids[i] = id
	}
	return ids, nil
}

// extractCreatedContracts finds multiple contract object IDs from a single
// transaction's ObjectChanges. Each typeSubstring corresponds to one expected
// contract. Returns IDs positionally matched: contractIDs[i] is the ID for
// typeSubstrings[i]. Uses first-match-first-consume to handle multiple
// contracts of the same type.
func extractCreatedContracts(resp *suiclient.SuiTransactionBlockResponse, typeSubstrings []string) []string {
	ids := make([]string, len(typeSubstrings))
	used := make(map[int]bool) // tracks which ObjectChanges have been consumed

	for i, sub := range typeSubstrings {
		for j, change := range resp.ObjectChanges {
			if used[j] {
				continue
			}
			if change.Data.Created != nil {
				if containsStr(string(change.Data.Created.ObjectType), sub) {
					ids[i] = change.Data.Created.ObjectId.String()
					used[j] = true
					break
				}
			}
		}
	}
	return ids
}

// --- CoinForItem ---

// createCoinForItem creates a CoinForItem<CORM_COIN> contract on-chain.
// The corm locks CORM as escrow, wanting items deposited by the player.
func (c *Client) createCoinForItem(ctx context.Context, cormID string, params ContractParams) (string, error) {
	destSSU, err := sui.ObjectIdFromHex(params.DestinationSSUID)
	if err != nil {
		return "", fmt.Errorf("invalid destination SSU: %w", err)
	}

	ptb := suiptb.NewTransactionDataTransactionBuilder()

	// Character (shared, immutable borrow)
	charArg, err := c.characterArg(ctx, ptb, false)
	if err != nil {
		return "", err
	}

	// Split escrow CORM
	escrowArg, err := c.splitCORMCoin(ctx, ptb, cormID, params.CORMEscrowAmount)
	if err != nil {
		return "", err
	}

	ptb.ProgrammableMoveCall(
		c.trustlessContractsPkg,
		"coin_for_item",
		"create",
		[]sui.TypeTag{c.cormCoinTypeTag()},
		[]suiptb.Argument{
			charArg,
			escrowArg,
			ptb.MustPure(params.WantedTypeID),
			ptb.MustPure(params.WantedQuantity),
			ptb.MustPure(destSSU),
			ptb.MustPure(params.AllowPartial),
			ptb.MustPure(false), // use_owner_inventory
			ptb.MustPure(uint64(params.DeadlineMs)),
		allowedCharsArg(ptb, params.PlayerCharacterID),
			allowedTribesArg(ptb, params.AllowedTribes),
			clockArg(ptb),
		},
	)

	resp, err := c.signAndExecute(ctx, ptb)
	if err != nil {
		return "", fmt.Errorf("execute coin_for_item::create: %w", err)
	}

	contractID := extractCreatedContract(resp, "coin_for_item::CoinForItemContract")
	if contractID == "" {
		return "", fmt.Errorf("contract object not found in transaction effects")
	}

	slog.Info(fmt.Sprintf("chain: CreateCoinForItem %s escrow=%d wanted_type=%d wanted_qty=%d player=%s",
		contractID, params.CORMEscrowAmount, params.WantedTypeID, params.WantedQuantity, params.PlayerAddress))
	return contractID, nil
}

// --- CoinForCoin ---

// createCoinForCoin creates a CoinForCoin<CORM_COIN, CORM_COIN> contract.
func (c *Client) createCoinForCoin(ctx context.Context, cormID string, params ContractParams) (string, error) {
	ptb := suiptb.NewTransactionDataTransactionBuilder()

	// Character (shared, immutable borrow)
	charArg, err := c.characterArg(ctx, ptb, false)
	if err != nil {
		return "", err
	}

	// Split escrow CORM
	escrowArg, err := c.splitCORMCoin(ctx, ptb, cormID, params.CORMEscrowAmount)
	if err != nil {
		return "", err
	}

	// coin_for_coin::create<CE, CF>
	cormTag := c.cormCoinTypeTag()
	ptb.ProgrammableMoveCall(
		c.trustlessContractsPkg,
		"coin_for_coin",
		"create",
		[]sui.TypeTag{cormTag, cormTag},
		[]suiptb.Argument{
			charArg,
			escrowArg,
		ptb.MustPure(params.CORMWantedAmount),
			ptb.MustPure(params.AllowPartial),
			ptb.MustPure(uint64(params.DeadlineMs)),
		allowedCharsArg(ptb, params.PlayerCharacterID),
			allowedTribesArg(ptb, params.AllowedTribes),
			clockArg(ptb),
		},
	)

	resp, err := c.signAndExecute(ctx, ptb)
	if err != nil {
		return "", fmt.Errorf("execute coin_for_coin::create: %w", err)
	}

	contractID := extractCreatedContract(resp, "coin_for_coin::CoinForCoinContract")
	if contractID == "" {
		return "", fmt.Errorf("contract object not found in transaction effects")
	}

	slog.Info(fmt.Sprintf("chain: CreateCoinForCoin %s escrow=%d wanted=%d player=%s",
		contractID, params.CORMEscrowAmount, params.CORMWantedAmount, params.PlayerAddress))
	return contractID, nil
}

// --- ItemForCoin ---

// createItemForCoin creates an ItemForCoin<CORM_COIN> contract on-chain.
// The corm offers items from its SSU inventory, wanting CORM in return.
// PTB sequence: borrow_owner_cap → withdraw_by_owner → return_owner_cap → create.
func (c *Client) createItemForCoin(ctx context.Context, cormID string, params ContractParams) (string, error) {
	sourceSSU, err := sui.ObjectIdFromHex(params.SourceSSUID)
	if err != nil {
		return "", fmt.Errorf("invalid source SSU: %w", err)
	}

	// Discover the OwnerCap<StorageUnit> held by the brain's Character for this SSU.
	ownerCapRef, err := c.findOwnerCapForSSU(ctx, sourceSSU)
	if err != nil {
		return "", fmt.Errorf("find OwnerCap for SSU %s: %w", params.SourceSSUID, err)
	}

	// Resolve shared objects
	charData, err := c.getSharedObjectRef(ctx, c.cormCharacterID)
	if err != nil {
		return "", fmt.Errorf("get Character ref: %w", err)
	}
	ssuData, err := c.getSharedObjectRef(ctx, sourceSSU)
	if err != nil {
		return "", fmt.Errorf("get SSU ref: %w", err)
	}

	ptb := suiptb.NewTransactionDataTransactionBuilder()

	// Character (shared, mutable — borrow_owner_cap takes &mut Character)
	charMutArg := ptb.MustObj(suiptb.ObjectArg{SharedObject: charData.SharedObjectArg(true)})

	// SSU (shared, mutable — create takes &mut StorageUnit)
	ssuArg := ptb.MustObj(suiptb.ObjectArg{SharedObject: ssuData.SharedObjectArg(true)})

	// Step 1: character::borrow_owner_cap<StorageUnit>(character, receiving_ticket)
	// The OwnerCap was transferred to the Character — use Receiving input.
	ownerCapReceivingArg := ptb.MustObj(suiptb.ObjectArg{Receiving: ownerCapRef})

	storageUnitTypeTag := c.storageUnitTypeTag()
	borrowResult := ptb.Command(suiptb.Command{
		MoveCall: &suiptb.ProgrammableMoveCall{
			Package:       c.worldPkg,
			Module:        "character",
			Function:      "borrow_owner_cap",
			TypeArguments: []sui.TypeTag{storageUnitTypeTag},
			Arguments:     []suiptb.Argument{charMutArg, ownerCapReceivingArg},
		},
	})
	// borrowResult returns (OwnerCap<StorageUnit>, Receipt) — access via NestedResult
	borrowCmdIdx := *borrowResult.Result
	ownerCapArg := suiptb.Argument{NestedResult: &suiptb.NestedResult{Cmd: borrowCmdIdx, Result: 0}}
	receiptArg := suiptb.Argument{NestedResult: &suiptb.NestedResult{Cmd: borrowCmdIdx, Result: 1}}

	// Step 2: storage_unit::withdraw_by_owner(ssu, character, owner_cap, type_id, quantity)
	// Character here is &Character (immutable borrow) — but we already have it as mutable
	// from step 1 and SUI allows &mut to degrade to & within the same PTB.
	withdrawResult := ptb.Command(suiptb.Command{
		MoveCall: &suiptb.ProgrammableMoveCall{
			Package:       c.worldPkg,
			Module:        "storage_unit",
			Function:      "withdraw_by_owner",
			TypeArguments: []sui.TypeTag{},
			Arguments: []suiptb.Argument{
				ssuArg,
				charMutArg,
				ownerCapArg,
				ptb.MustPure(params.OfferedTypeID),
				ptb.MustPure(params.OfferedQuantity),
			},
		},
	})
	itemArg := withdrawResult // Result is inventory::Item

	// Step 3: character::return_owner_cap(character, owner_cap, receipt)
	ptb.Command(suiptb.Command{
		MoveCall: &suiptb.ProgrammableMoveCall{
			Package:       c.worldPkg,
			Module:        "character",
			Function:      "return_owner_cap",
			TypeArguments: []sui.TypeTag{storageUnitTypeTag},
			Arguments:     []suiptb.Argument{charMutArg, ownerCapArg, receiptArg},
		},
	})

	// Step 4: item_for_coin::create<CORM_COIN>(character, source_ssu, item, ...)
	ptb.ProgrammableMoveCall(
		c.trustlessContractsPkg,
		"item_for_coin",
		"create",
		[]sui.TypeTag{c.cormCoinTypeTag()},
		[]suiptb.Argument{
			charMutArg, // &Character (immutable borrow, degraded from &mut)
			ssuArg,
			itemArg,
			ptb.MustPure(params.CORMWantedAmount),
			ptb.MustPure(params.AllowPartial),
			ptb.MustPure(uint64(params.DeadlineMs)),
		allowedCharsArg(ptb, params.PlayerCharacterID),
			allowedTribesArg(ptb, params.AllowedTribes),
			clockArg(ptb),
		},
	)

	resp, err := c.signAndExecute(ctx, ptb)
	if err != nil {
		return "", fmt.Errorf("execute item_for_coin::create: %w", err)
	}

	contractID := extractCreatedContract(resp, "item_for_coin::ItemForCoinContract")
	if contractID == "" {
		return "", fmt.Errorf("contract object not found in transaction effects")
	}

	slog.Info(fmt.Sprintf("chain: CreateItemForCoin %s offered_type=%d offered_qty=%d wanted_corm=%d player=%s",
		contractID, params.OfferedTypeID, params.OfferedQuantity, params.CORMWantedAmount, params.PlayerAddress))
	return contractID, nil
}

// --- ItemForItem ---

// createItemForItem creates an ItemForItem contract on-chain.
// The corm offers items from its SSU, wanting different items deposited at a destination SSU.
// PTB sequence: borrow_owner_cap → withdraw_by_owner → return_owner_cap → create.
func (c *Client) createItemForItem(ctx context.Context, cormID string, params ContractParams) (string, error) {
	sourceSSU, err := sui.ObjectIdFromHex(params.SourceSSUID)
	if err != nil {
		return "", fmt.Errorf("invalid source SSU: %w", err)
	}
	destSSU, err := sui.ObjectIdFromHex(params.DestinationSSUID)
	if err != nil {
		return "", fmt.Errorf("invalid destination SSU: %w", err)
	}

	// Discover OwnerCap
	ownerCapRef, err := c.findOwnerCapForSSU(ctx, sourceSSU)
	if err != nil {
		return "", fmt.Errorf("find OwnerCap for SSU %s: %w", params.SourceSSUID, err)
	}

	// Resolve shared objects
	charData, err := c.getSharedObjectRef(ctx, c.cormCharacterID)
	if err != nil {
		return "", fmt.Errorf("get Character ref: %w", err)
	}
	ssuData, err := c.getSharedObjectRef(ctx, sourceSSU)
	if err != nil {
		return "", fmt.Errorf("get SSU ref: %w", err)
	}

	ptb := suiptb.NewTransactionDataTransactionBuilder()

	charMutArg := ptb.MustObj(suiptb.ObjectArg{SharedObject: charData.SharedObjectArg(true)})
	ssuArg := ptb.MustObj(suiptb.ObjectArg{SharedObject: ssuData.SharedObjectArg(true)})

	// Step 1: borrow_owner_cap
	ownerCapReceivingArg := ptb.MustObj(suiptb.ObjectArg{Receiving: ownerCapRef})
	storageUnitTypeTag := c.storageUnitTypeTag()
	borrowResult := ptb.Command(suiptb.Command{
		MoveCall: &suiptb.ProgrammableMoveCall{
			Package:       c.worldPkg,
			Module:        "character",
			Function:      "borrow_owner_cap",
			TypeArguments: []sui.TypeTag{storageUnitTypeTag},
			Arguments:     []suiptb.Argument{charMutArg, ownerCapReceivingArg},
		},
	})
	borrowCmdIdx := *borrowResult.Result
	ownerCapArg := suiptb.Argument{NestedResult: &suiptb.NestedResult{Cmd: borrowCmdIdx, Result: 0}}
	receiptArg := suiptb.Argument{NestedResult: &suiptb.NestedResult{Cmd: borrowCmdIdx, Result: 1}}

	// Step 2: withdraw_by_owner
	withdrawResult := ptb.Command(suiptb.Command{
		MoveCall: &suiptb.ProgrammableMoveCall{
			Package:       c.worldPkg,
			Module:        "storage_unit",
			Function:      "withdraw_by_owner",
			TypeArguments: []sui.TypeTag{},
			Arguments: []suiptb.Argument{
				ssuArg,
				charMutArg,
				ownerCapArg,
				ptb.MustPure(params.OfferedTypeID),
				ptb.MustPure(params.OfferedQuantity),
			},
		},
	})
	itemArg := withdrawResult

	// Step 3: return_owner_cap
	ptb.Command(suiptb.Command{
		MoveCall: &suiptb.ProgrammableMoveCall{
			Package:       c.worldPkg,
			Module:        "character",
			Function:      "return_owner_cap",
			TypeArguments: []sui.TypeTag{storageUnitTypeTag},
			Arguments:     []suiptb.Argument{charMutArg, ownerCapArg, receiptArg},
		},
	})

	// Step 4: item_for_item::create(character, source_ssu, item, ...)
	ptb.ProgrammableMoveCall(
		c.trustlessContractsPkg,
		"item_for_item",
		"create",
		[]sui.TypeTag{},
		[]suiptb.Argument{
			charMutArg,
			ssuArg,
			itemArg,
			ptb.MustPure(params.WantedTypeID),
			ptb.MustPure(params.WantedQuantity),
			ptb.MustPure(destSSU),
			ptb.MustPure(params.AllowPartial),
			ptb.MustPure(false), // use_owner_inventory
			ptb.MustPure(uint64(params.DeadlineMs)),
		allowedCharsArg(ptb, params.PlayerCharacterID),
			allowedTribesArg(ptb, params.AllowedTribes),
			clockArg(ptb),
		},
	)

	resp, err := c.signAndExecute(ctx, ptb)
	if err != nil {
		return "", fmt.Errorf("execute item_for_item::create: %w", err)
	}

	contractID := extractCreatedContract(resp, "item_for_item::ItemForItemContract")
	if contractID == "" {
		return "", fmt.Errorf("contract object not found in transaction effects")
	}

	slog.Info(fmt.Sprintf("chain: CreateItemForItem %s offered_type=%d offered_qty=%d wanted_type=%d wanted_qty=%d player=%s",
		contractID, params.OfferedTypeID, params.OfferedQuantity, params.WantedTypeID, params.WantedQuantity, params.PlayerAddress))
	return contractID, nil
}

// --- OwnerCap Discovery ---

// findOwnerCapForSSU queries objects received by the brain's Character to find
// an OwnerCap<StorageUnit> associated with the given SSU. Returns the ObjectRef
// for use as a Receiving input in PTB.
func (c *Client) findOwnerCapForSSU(ctx context.Context, ssuID *sui.ObjectId) (*sui.ObjectRef, error) {
	ownerCapType := fmt.Sprintf("%s::access::OwnerCap<%s::storage_unit::StorageUnit>", c.worldPkg.String(), c.worldPkg.String())
	ownerCapStructTag := &sui.StructTag{
		Address: sui.MustAddressFromHex(c.worldPkg.String()),
		Module:  "access",
		Name:    "OwnerCap",
		TypeParams: []sui.TypeTag{{
			Struct: &sui.StructTag{
				Address: sui.MustAddressFromHex(c.worldPkg.String()),
				Module:  "storage_unit",
				Name:    "StorageUnit",
			},
		}},
	}

	// Query objects owned by (transferred to) the Character object.
	// In SUI, objects transferred to another object are queryable via
	// GetOwnedObjects with the receiving object's ID as the owner address.
	charAddr := sui.MustAddressFromHex(c.cormCharacterID.String())
	resp, err := c.rpc.GetOwnedObjects(ctx, &suiclient.GetOwnedObjectsRequest{
		Address: charAddr,
		Query: &suiclient.SuiObjectResponseQuery{
			Filter: &suiclient.SuiObjectDataFilter{
				StructType: ownerCapStructTag,
			},
			Options: &suiclient.SuiObjectDataOptions{
				ShowContent: true,
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("query OwnerCaps: %w", err)
	}

	// Find the OwnerCap whose `object_id` field matches the target SSU.
	// Eve Frontier's OwnerCap<T> struct has an `object_id: ID` field pointing
	// to the owned structure.  We parse it from the content fields (already
	// fetched with ShowContent: true) and compare against ssuID.
	//
	// Falls back to first-match if the field is absent or unparseable, which
	// preserves single-SSU backward compatibility.
	_ = ownerCapType // for error messages
	targetIDStr := strings.ToLower(ssuID.String())
	var firstMatch *sui.ObjectRef
	for _, obj := range resp.Data {
		if obj.Data == nil {
			continue
		}
		if firstMatch == nil {
			ref := obj.Data.Ref()
			firstMatch = ref
		}
		// Try to match by object_id field.
		if obj.Data.Content == nil || obj.Data.Content.Data.MoveObject == nil {
			continue
		}
		candidateSSUID := parseOwnerCapObjectID(obj.Data.Content.Data.MoveObject.Fields)
		if strings.ToLower(candidateSSUID) == targetIDStr {
			return obj.Data.Ref(), nil
		}
	}
	if firstMatch != nil {
		slog.Debug(fmt.Sprintf("chain: findOwnerCapForSSU: no exact match for SSU %s, using first OwnerCap", ssuID))
		return firstMatch, nil
	}

	return nil, fmt.Errorf("no OwnerCap<StorageUnit> found for Character %s", c.cormCharacterID)
}

// storageUnitTypeTag returns the TypeTag for world::storage_unit::StorageUnit.
func (c *Client) storageUnitTypeTag() sui.TypeTag {
	return sui.TypeTag{
		Struct: &sui.StructTag{
			Address: sui.MustAddressFromHex(c.worldPkg.String()),
			Module:  "storage_unit",
			Name:    "StorageUnit",
		},
	}
}

// --- Coin Lookup ---

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
	default:
		slog.Info(fmt.Sprintf("chain: stub CreateContract %s type=%s player=%s", contractID, params.ContractType, params.PlayerAddress))
	}

	return contractID, nil
}
