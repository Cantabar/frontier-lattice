package chain

import (
	"context"
	"fmt"
	"log"
	"math"
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

// MintCORM mints CORM tokens and transfers them to the player.
// `amount` is in base units (1 CORM = 10,000 base units).
// Use CormToBaseUnits to convert from human-readable amounts.
// TODO: Implement via PTB calling corm_coin::mint + transfer::public_transfer.
func (c *Client) MintCORM(ctx context.Context, cormID, playerAddress string, amount uint64) error {
	if !c.HasSigner() {
		return fmt.Errorf("no signer configured")
	}

	log.Printf("chain: stub MintCORM %d base units (%.4f CORM) to %s (corm %s)",
		amount, float64(amount)/float64(CormBaseUnit), playerAddress, cormID)
	return nil
}
