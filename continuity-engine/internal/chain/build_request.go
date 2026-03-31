package chain

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pattonkan/sui-go/sui"
	"github.com/pattonkan/sui-go/sui/suiptb"
)

// BuildRequestParams holds parameters for creating a witnessed build_request
// contract on-chain. The poster escrows a CORM bounty for building a specific
// structure type (e.g. Storage Unit). Fulfillment is verified cryptographically
// by the indexer's witness service.
type BuildRequestParams struct {
	RequestedTypeID uint64 // in-game structure type ID (e.g. SSU type)
	RequireCormAuth bool   // require CormAuth extension on the structure
	BountyAmount    uint64 // CORM amount to escrow as bounty
	DeadlineMs      int64  // Unix timestamp in milliseconds
	CormStateID     string // on-chain CormState object ID (for inline minting fallback)

	// Access control (same pattern as trustless contracts)
	PlayerCharacterID string   // restrict to this Character ID (empty = unrestricted)
	AllowedTribes     []uint32 // restrict to these tribe IDs (empty = unrestricted)
}

// CreateBuildRequest creates a witnessed BuildRequestContract<CORM_COIN> on-chain.
// The corm-brain posts a bounty for building a specific structure type. The
// indexer's witness service detects the build and submits a cryptographic
// attestation to fulfill the contract.
//
// PTB structure:
//  1. Split CORM coin for bounty escrow
//  2. build_request::create<CORM_COIN>(poster_id, poster_address, bounty_coin,
//     requested_type_id, require_corm_auth, deadline_ms, allowed_characters,
//     allowed_tribes, reference_structure_id, max_distance, proximity_tribe_id,
//     clock)
func (c *Client) CreateBuildRequest(ctx context.Context, params BuildRequestParams) (string, error) {
	if !c.HasSigner() {
		return "", fmt.Errorf("no signer configured")
	}

	// Fall back to stub if required config is missing.
	if c.witnessedContractsPkg == nil || c.cormStatePkg == nil || c.cormCharacterID == nil {
		return c.createBuildRequestStub(params)
	}

	ptb := suiptb.NewTransactionDataTransactionBuilder()

	// Character ID as a pure ID value (not a shared object reference —
	// build_request::create takes poster_id: ID, not &Character).
	posterIDArg := ptb.MustPure(c.cormCharacterID)

	// Poster address (brain's signer address).
	posterAddrArg := ptb.MustPure(c.signer.Address())

	// Split CORM coin for bounty escrow.
	bountyArg, err := c.splitCORMCoin(ctx, ptb, params.CormStateID, params.BountyAmount)
	if err != nil {
		return "", fmt.Errorf("split CORM for bounty: %w", err)
	}

	// Build allowed_characters vector<ID>.
	allowedCharsArg := allowedCharsArg(ptb, params.PlayerCharacterID)

	// Build allowed_tribes vector<u32>.
	allowedTribesArg := allowedTribesArg(ptb, params.AllowedTribes)

	// Proximity fields: all None for SSU build requests.
	// Option<ID> None, Option<u64> None, Option<u32> None.
	var noneID *sui.ObjectId
	var noneU64 *uint64
	var noneU32 *uint32
	refStructArg := ptb.MustPure(noneID)
	maxDistArg := ptb.MustPure(noneU64)
	proxTribeArg := ptb.MustPure(noneU32)

	clkArg := clockArg(ptb)

	ptb.ProgrammableMoveCall(
		c.witnessedContractsPkg,
		"build_request",
		"create",
		[]sui.TypeTag{c.cormCoinTypeTag()},
		[]suiptb.Argument{
			posterIDArg,
			posterAddrArg,
			bountyArg,
			ptb.MustPure(params.RequestedTypeID),
			ptb.MustPure(params.RequireCormAuth),
			ptb.MustPure(uint64(params.DeadlineMs)),
			allowedCharsArg,
			allowedTribesArg,
			refStructArg,
			maxDistArg,
			proxTribeArg,
			clkArg,
		},
	)

	resp, err := c.signAndExecute(ctx, ptb)
	if err != nil {
		return "", fmt.Errorf("execute build_request::create: %w", err)
	}

	contractID := extractCreatedContract(resp, "build_request::BuildRequestContract")
	if contractID == "" {
		return "", fmt.Errorf("BuildRequestContract object not found in transaction effects")
	}

	slog.Info(fmt.Sprintf("chain: CreateBuildRequest %s type=%d corm_auth=%t bounty=%d",
		contractID, params.RequestedTypeID, params.RequireCormAuth, params.BountyAmount))
	return contractID, nil
}

// createBuildRequestStub returns a placeholder contract ID when chain config
// is incomplete. Used for local dev and graceful degradation.
func (c *Client) createBuildRequestStub(params BuildRequestParams) (string, error) {
	contractID := fmt.Sprintf("build_request_%d_%d", params.RequestedTypeID, params.DeadlineMs)
	slog.Info(fmt.Sprintf("chain: stub CreateBuildRequest %s type=%d corm_auth=%t bounty=%d",
		contractID, params.RequestedTypeID, params.RequireCormAuth, params.BountyAmount))
	return contractID, nil
}
