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

// findMintCap looks up the MintCap owned by the brain for a given CormState.
func (c *Client) findMintCap(ctx context.Context, cormStateID *sui.ObjectId) (*sui.ObjectRef, error) {
	mintCapType := fmt.Sprintf("%s::corm_coin::MintCap", c.cormStatePkg.String())
	mintCapStructTag := &sui.StructTag{
		Address: sui.MustAddressFromHex(c.cormStatePkg.String()),
		Module:  "corm_coin",
		Name:    "MintCap",
	}
	_ = mintCapType // used only for error messages

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
	})
	if err != nil {
		return nil, fmt.Errorf("query owned MintCaps: %w", err)
	}

	// Find the MintCap whose corm_state_id matches
	targetID := cormStateID.String()
	for _, obj := range resp.Data {
		if obj.Data == nil || obj.Data.Content == nil || obj.Data.Content.Data.MoveObject == nil {
			continue
		}
		var fields map[string]interface{}
		if err := json.Unmarshal(obj.Data.Content.Data.MoveObject.Fields, &fields); err != nil {
			continue
		}
		if csID, ok := fields["corm_state_id"]; ok && fmt.Sprint(csID) == targetID {
			return obj.Data.Ref(), nil
		}
	}

	return nil, fmt.Errorf("no MintCap found for corm %s", cormStateID)
}
