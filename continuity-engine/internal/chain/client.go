// Package chain provides SUI blockchain interaction for the continuity-engine service.
//
// This package wraps pattonkan/sui-go for JSON-RPC calls, PTB building,
// Ed25519 signing, and BCS decoding.
package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"

	"github.com/pattonkan/sui-go/sui"
	"github.com/pattonkan/sui-go/suiclient"
)

// SUI system Clock object — always at address 0x6.
var SuiClockObjectID = sui.MustObjectIdFromHex("0x0000000000000000000000000000000000000000000000000000000000000006")

// ClientConfig holds on-chain object/package IDs for a single environment.
type ClientConfig struct {
	RpcURL    string
	PackageID string // corm_state package (published-at — for MoveCall targets)

	// OriginalID is the corm_state package's original-id (set at first publish).
	// On Sui, struct types (MintCap, CORM_COIN, etc.) are permanently anchored
	// to the original-id, even after upgrades. If empty, falls back to PackageID
	// (correct for v1 packages that have never been upgraded).
	OriginalID string

	TrustlessContractsPackageID  string
	CormAuthPackageID            string
	WorldPackageID               string // Eve Frontier world contracts (character, storage_unit, inventory)
	WitnessedContractsPackageID  string // witnessed_contracts package (build_request)
	CormConfigObjectID           string // shared CormConfig
	CoinAuthorityObjectID        string // shared CoinAuthority
	WitnessRegistryObjectID      string // shared WitnessRegistry (for witnessed contract creates)
	CormCharacterID              string // brain's on-chain Character (shared object)
}

// Client wraps SUI RPC access for reading and writing on-chain state.
type Client struct {
	rpc       *suiclient.ClientImpl
	signer    *Signer
	seedMode  bool // when true, stub methods return mock data

	// Optional item registry for TypeName resolution in inventory reads.
	registry *Registry

	// Package IDs (parsed at init)
	cormStatePkg            *sui.PackageId // published-at (for MoveCall targets)
	cormStateOriginalPkg    *sui.PackageId // original-id (for type matching); nil → use cormStatePkg
	trustlessContractsPkg   *sui.PackageId
	cormAuthPkg             *sui.PackageId
	worldPkg                *sui.PackageId
	witnessedContractsPkg   *sui.PackageId

	// Shared object IDs (parsed at init)
	cormConfigObjID         *sui.ObjectId
	coinAuthorityObjID      *sui.ObjectId
	cormCharacterID         *sui.ObjectId
	witnessRegistryObjID    *sui.ObjectId

	// MintCap cache: cormStateID (hex) → ObjectRef. Stable 1:1 relationship;
	// entries are evicted on transaction error (stale object version).
	mintCapMu    sync.RWMutex
	mintCapCache map[string]*sui.ObjectRef
}

// NewClient creates a SUI chain client.
func NewClient(cfg ClientConfig, privateKey string) *Client {
	c := &Client{
		rpc:          suiclient.NewClient(cfg.RpcURL),
		mintCapCache: make(map[string]*sui.ObjectRef),
	}

	// Parse package IDs (optional — may be empty during early dev)
	c.cormStatePkg = mustParseObjectIdOrNil(cfg.PackageID)
	c.cormStateOriginalPkg = mustParseObjectIdOrNil(cfg.OriginalID)
	c.trustlessContractsPkg = mustParseObjectIdOrNil(cfg.TrustlessContractsPackageID)
	c.cormAuthPkg = mustParseObjectIdOrNil(cfg.CormAuthPackageID)
	c.worldPkg = mustParseObjectIdOrNil(cfg.WorldPackageID)
	c.witnessedContractsPkg = mustParseObjectIdOrNil(cfg.WitnessedContractsPackageID)

	// Parse shared object IDs
	c.cormConfigObjID = mustParseObjectIdOrNil(cfg.CormConfigObjectID)
	c.coinAuthorityObjID = mustParseObjectIdOrNil(cfg.CoinAuthorityObjectID)
	c.cormCharacterID = mustParseObjectIdOrNil(cfg.CormCharacterID)
	c.witnessRegistryObjID = mustParseObjectIdOrNil(cfg.WitnessRegistryObjectID)

	// Initialize signer
	if privateKey != "" {
		var err error
		c.signer, err = NewSigner(privateKey)
		if err != nil {
			slog.Error(fmt.Sprintf("chain: failed to initialize signer: %v", err))
		} else {
			slog.Info(fmt.Sprintf("chain: initialized signer for address %s", c.signer.AddressString()))
		}
	} else {
		slog.Info("chain: WARNING — no SUI_PRIVATE_KEY set, on-chain writes disabled")
	}

	return c
}

// SetRegistry attaches an item registry to the client so that inventory
// reads can populate InventoryItem.TypeName from on-chain type IDs.
// Should be called once after both the registry and the client are created.
func (c *Client) SetRegistry(r *Registry) {
	c.registry = r
}

// SetSeedMode enables or disables seed data for stub chain methods.
func (c *Client) SetSeedMode(enabled bool) {
	c.seedMode = enabled
	if enabled {
		slog.Info("chain: seed mode ENABLED — stub methods return mock data")
	}
}

// HasSigner returns true if the client can sign transactions.
func (c *Client) HasSigner() bool {
	return c.signer != nil
}

// CanCreateContracts returns true if the client has all the config needed
// to create on-chain contracts: a signer, the trustless contracts package,
// and the corm character ID. When this returns false, contract creation
// will always fail, so callers should skip generation entirely.
func (c *Client) CanCreateContracts() bool {
	return c.signer != nil && c.trustlessContractsPkg != nil && c.cormStatePkg != nil && c.cormCharacterID != nil
}

// CanCreateItemContracts returns true if the client can create item-based
// contracts (item_for_coin, item_for_item) which additionally require the
// world package and corm_auth package for SSU withdrawal via OwnerCap.
func (c *Client) CanCreateItemContracts() bool {
	return c.CanCreateContracts() && c.worldPkg != nil && c.cormAuthPkg != nil
}

// CanUpdateCormState returns true if the client has the config needed to
// update on-chain CormState: a signer and the corm_state package ID.
func (c *Client) CanUpdateCormState() bool {
	return c.signer != nil && c.cormStatePkg != nil
}

// CanMintCORM returns true if the client has the config needed to mint CORM:
// a signer, the corm state package, and the coin authority object.
func (c *Client) CanMintCORM() bool {
	return c.signer != nil && c.cormStatePkg != nil && c.coinAuthorityObjID != nil
}

// CanCreateBuildRequests returns true if the client has all the config needed
// to create on-chain build_request witnessed contracts: a signer, the
// witnessed_contracts package, the corm_state package (for CORM coin type),
// and the character ID.
func (c *Client) CanCreateBuildRequests() bool {
	return c.signer != nil && c.witnessedContractsPkg != nil && c.cormStatePkg != nil && c.cormCharacterID != nil
}

// cormStateTypePkg returns the package address to use for type matching
// (StructTag filters, TypeTag arguments, coin type strings). After a
// package upgrade, struct types are anchored to the original-id, not
// published-at. Falls back to cormStatePkg if no original-id is configured
// (correct for v1 packages that have never been upgraded).
func (c *Client) cormStateTypePkg() *sui.PackageId {
	if c.cormStateOriginalPkg != nil {
		return c.cormStateOriginalPkg
	}
	return c.cormStatePkg
}

// CORMCoinType returns the fully-qualified coin type string for CORM_COIN.
// Uses original-id for type matching (struct types are anchored at first publish).
// e.g. "0xabc123::corm_coin::CORM_COIN"
func (c *Client) CORMCoinType() string {
	typePkg := c.cormStateTypePkg()
	if typePkg == nil {
		return ""
	}
	return fmt.Sprintf("%s::corm_coin::CORM_COIN", typePkg.String())
}

// VerifyBrainAddress reads the on-chain CormConfig shared object and compares
// its brain_address field to the signer's address. Logs a WARNING if they
// differ, since MintCaps from install() are transferred to brain_address —
// a mismatch means findMintCap will never find them.
//
// Safe to call at startup; returns nil if config is not available (early dev).
func (c *Client) VerifyBrainAddress(ctx context.Context) error {
	if c.cormConfigObjID == nil || c.signer == nil {
		return nil // not configured — nothing to verify
	}

	resp, err := c.rpc.GetObject(ctx, &suiclient.GetObjectRequest{
		ObjectId: c.cormConfigObjID,
		Options:  &suiclient.SuiObjectDataOptions{ShowContent: true},
	})
	if err != nil {
		return fmt.Errorf("read CormConfig %s: %w", c.cormConfigObjID, err)
	}
	if resp.Data == nil || resp.Data.Content == nil || resp.Data.Content.Data.MoveObject == nil {
		slog.Warn(fmt.Sprintf("chain: VerifyBrainAddress: CormConfig %s has no content", c.cormConfigObjID))
		return nil
	}

	var fields map[string]interface{}
	if err := json.Unmarshal(resp.Data.Content.Data.MoveObject.Fields, &fields); err != nil {
		return fmt.Errorf("parse CormConfig fields: %w", err)
	}

	brainAddr := fmt.Sprint(fields["brain_address"])
	signerAddr := c.signer.AddressString()

	if brainAddr != signerAddr {
		slog.Error(fmt.Sprintf(
			"chain: BRAIN ADDRESS MISMATCH — CormConfig.brain_address=%s but signer=%s. "+
				"MintCaps from install() are transferred to brain_address, so findMintCap "+
				"will fail. Fix: call set_brain_address with CormAdminCap, or update SUI_PRIVATE_KEY.",
			brainAddr, signerAddr))
	} else {
		slog.Info(fmt.Sprintf("chain: VerifyBrainAddress OK — signer matches CormConfig.brain_address (%s)", signerAddr))
	}

	return nil
}

// InvalidateMintCapCache removes a cached MintCap entry for a given corm.
// Called when a transaction using the cached ref fails (stale object version).
func (c *Client) InvalidateMintCapCache(cormStateID string) {
	c.mintCapMu.Lock()
	delete(c.mintCapCache, cormStateID)
	c.mintCapMu.Unlock()
}

// mustParseObjectIdOrNil parses a hex object ID string, returning nil if empty.
func mustParseObjectIdOrNil(s string) *sui.ObjectId {
	if s == "" {
		return nil
	}
	id, err := sui.ObjectIdFromHex(s)
	if err != nil {
		slog.Error(fmt.Sprintf("chain: invalid object ID %q: %v", s, err))
		return nil
	}
	return id
}
