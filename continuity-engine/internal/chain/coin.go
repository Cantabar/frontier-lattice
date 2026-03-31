package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"

	"github.com/pattonkan/sui-go/sui"
	"github.com/pattonkan/sui-go/sui/suiptb"
	"github.com/pattonkan/sui-go/suiclient"
)

// CormDecimals is the number of decimal places for the CORM token.
// 1 CORM = 10^CormDecimals base units = 10,000 base units.
// This matches the on-chain CoinMetadata created in corm_coin::init.
const CormDecimals = 4

// CormBaseUnit is the multiplier to convert human-readable CORM amounts
// to on-chain base units: humanAmount * CormBaseUnit = baseUnits.
var CormBaseUnit = uint64(math.Pow10(CormDecimals)) // 10,000

// CormToBaseUnits converts a human-readable CORM amount (e.g. 4.27 LUX
// equivalent) to the on-chain u64 base-unit representation.
func CormToBaseUnits(human float64) uint64 {
	return uint64(math.Round(human * float64(CormBaseUnit)))
}

// MintCORM mints CORM tokens and transfers them to the player via
// corm_coin::mint(authority, mint_cap, corm_state_id, amount, recipient).
// `amount` is in base units (1 CORM = 10,000 base units).
func (c *Client) MintCORM(ctx context.Context, cormID, playerAddress string, amount uint64) error {
	if !c.HasSigner() {
		return fmt.Errorf("no signer configured")
	}
	if c.cormStatePkg == nil || c.coinAuthorityObjID == nil {
		slog.Info(fmt.Sprintf("chain: stub MintCORM %d base units (%.4f CORM) to %s (corm %s) — missing config",
			amount, float64(amount)/float64(CormBaseUnit), playerAddress, cormID))
		return nil
	}

	cormStateID, err := sui.ObjectIdFromHex(cormID)
	if err != nil {
		return fmt.Errorf("invalid corm ID: %w", err)
	}

	recipient, err := sui.AddressFromHex(playerAddress)
	if err != nil {
		return fmt.Errorf("invalid player address: %w", err)
	}

	// Look up the MintCap owned by the brain for this corm
	mintCapRef, err := c.findMintCap(ctx, cormStateID)
	if err != nil {
		return fmt.Errorf("find MintCap: %w", err)
	}

	// Look up CoinAuthority shared object
	authorityRef, err := c.getSharedObjectRef(ctx, c.coinAuthorityObjID)
	if err != nil {
		return fmt.Errorf("get CoinAuthority ref: %w", err)
	}

	// Build PTB: corm_coin::mint(authority, mint_cap, corm_state_id, amount, recipient)
	ptb := suiptb.NewTransactionDataTransactionBuilder()

	authorityArg := ptb.MustObj(suiptb.ObjectArg{
		SharedObject: authorityRef.SharedObjectArg(true),
	})

	mintCapArg := ptb.MustObj(suiptb.ObjectArg{
		ImmOrOwnedObject: mintCapRef,
	})

	cormStateIDArg := ptb.MustPure(cormStateID)
	amountArg := ptb.MustPure(amount)
	recipientArg := ptb.MustPure(recipient)

	ptb.ProgrammableMoveCall(
		c.cormStatePkg,
		"corm_coin",
		"mint",
		[]sui.TypeTag{},
		[]suiptb.Argument{authorityArg, mintCapArg, cormStateIDArg, amountArg, recipientArg},
	)

	if _, err := c.signAndExecute(ctx, ptb); err != nil {
		return fmt.Errorf("execute mint: %w", err)
	}

	slog.Info(fmt.Sprintf("chain: MintCORM %d base units (%.4f CORM) to %s (corm %s)",
		amount, float64(amount)/float64(CormBaseUnit), playerAddress, cormID))
	return nil
}

// mintCORMCoinArg adds a corm_coin::mint_coin MoveCall to the given PTB and
// returns the resulting Argument (a Coin<CORM_COIN>). This enables composable
// minting within a single PTB — the returned coin can be passed directly to
// SplitCoins or contract create calls without a separate transaction.
func (c *Client) mintCORMCoinArg(ctx context.Context, ptb *suiptb.ProgrammableTransactionBuilder, cormStateID string, amount uint64) (suiptb.Argument, error) {
	if c.cormStatePkg == nil || c.coinAuthorityObjID == nil {
		return suiptb.Argument{}, fmt.Errorf("mint config missing (pkg=%t authority=%t)", c.cormStatePkg != nil, c.coinAuthorityObjID != nil)
	}

	cormObjID, err := sui.ObjectIdFromHex(cormStateID)
	if err != nil {
		return suiptb.Argument{}, fmt.Errorf("invalid corm state ID: %w", err)
	}

	mintCapRef, err := c.findMintCap(ctx, cormObjID)
	if err != nil {
		return suiptb.Argument{}, fmt.Errorf("find MintCap: %w", err)
	}

	authorityRef, err := c.getSharedObjectRef(ctx, c.coinAuthorityObjID)
	if err != nil {
		return suiptb.Argument{}, fmt.Errorf("get CoinAuthority ref: %w", err)
	}

	authorityArg := ptb.MustObj(suiptb.ObjectArg{
		SharedObject: authorityRef.SharedObjectArg(true),
	})
	mintCapArg := ptb.MustObj(suiptb.ObjectArg{
		ImmOrOwnedObject: mintCapRef,
	})
	cormStateIDArg := ptb.MustPure(cormObjID)
	amountArg := ptb.MustPure(amount)

	// corm_coin::mint_coin(authority, mint_cap, corm_state_id, amount) -> Coin<CORM_COIN>
	result := ptb.Command(suiptb.Command{
		MoveCall: &suiptb.ProgrammableMoveCall{
			Package:       c.cormStatePkg,
			Module:        "corm_coin",
			Function:      "mint_coin",
			TypeArguments: []sui.TypeTag{},
			Arguments:     []suiptb.Argument{authorityArg, mintCapArg, cormStateIDArg, amountArg},
		},
	})

	slog.Info(fmt.Sprintf("chain: mintCORMCoinArg %d base units inline in PTB for corm %s", amount, cormStateID))
	return result, nil
}

// CanMintInline returns true if the client has the config needed to mint
// CORM inline within a PTB (corm_coin::mint_coin). Requires the corm_state
// package and coin authority object.
func (c *Client) CanMintInline() bool {
	return c.HasSigner() && c.cormStatePkg != nil && c.coinAuthorityObjID != nil
}

// findMintCap looks up the MintCap owned by the brain for a given CormState.
// Uses a per-client cache (stable 1:1 relationship) and paginates through
// all owned MintCap objects to avoid missing entries beyond the first page.
func (c *Client) findMintCap(ctx context.Context, cormStateID *sui.ObjectId) (*sui.ObjectRef, error) {
	cacheKey := cormStateID.String()

	// Check cache first.
	c.mintCapMu.RLock()
	if ref, ok := c.mintCapCache[cacheKey]; ok {
		c.mintCapMu.RUnlock()
		return ref, nil
	}
	c.mintCapMu.RUnlock()

	// Use original-id for type matching — struct types are anchored at first publish.
	typePkg := c.cormStateTypePkg()
	mintCapStructTag := &sui.StructTag{
		Address: sui.MustAddressFromHex(typePkg.String()),
		Module:  "corm_coin",
		Name:    "MintCap",
	}

	targetID := cormStateID.String()
	var totalSeen int
	var cursor *suiclient.CheckpointedObjectId

	for {
		resp, err := c.rpc.GetOwnedObjects(ctx, &suiclient.GetOwnedObjectsRequest{
			Address: c.signer.Address(),
			Query: &suiclient.SuiObjectResponseQuery{
				Filter: &suiclient.SuiObjectDataFilter{
					StructType: mintCapStructTag,
				},
				Options: &suiclient.SuiObjectDataOptions{
					ShowContent: true,
				},
			},
			Cursor: cursor,
		})
		if err != nil {
			return nil, fmt.Errorf("query owned MintCaps: %w", err)
		}

		for _, obj := range resp.Data {
			totalSeen++
			if obj.Data == nil || obj.Data.Content == nil || obj.Data.Content.Data.MoveObject == nil {
				continue
			}
			var fields map[string]interface{}
			if err := json.Unmarshal(obj.Data.Content.Data.MoveObject.Fields, &fields); err != nil {
				continue
			}
			if csID, ok := fields["corm_state_id"]; ok && fmt.Sprint(csID) == targetID {
				ref := obj.Data.Ref()
				// Cache the result.
				c.mintCapMu.Lock()
				c.mintCapCache[cacheKey] = ref
				c.mintCapMu.Unlock()
				return ref, nil
			}
		}

		if !resp.HasNextPage || resp.NextCursor == nil {
			break
		}
		cursor = &suiclient.CheckpointedObjectId{
			ObjectId: *resp.NextCursor,
		}
	}

	return nil, fmt.Errorf("no MintCap found for corm %s (signer=%s, scanned %d MintCap objects)",
		cormStateID, c.signer.AddressString(), totalSeen)
}
