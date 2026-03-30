// Package chain provides SUI blockchain interaction for the continuity-engine service.
//
// This package wraps pattonkan/sui-go for JSON-RPC calls, PTB building,
// Ed25519 signing, and BCS decoding. The real implementation will be added
// once the CormState Move contracts are deployed.
package chain

import (
	"log/slog"
	"fmt"
)

// Client wraps SUI RPC access for reading and writing on-chain state.
type Client struct {
	rpcURL    string
	packageID string
	signer    *Signer
	seedMode  bool // when true, stub methods return mock data
}

// NewClient creates a SUI chain client.
func NewClient(rpcURL, packageID, privateKey string) *Client {
	var signer *Signer
	if privateKey != "" {
		signer = NewSigner(privateKey)
		slog.Info(fmt.Sprintf("chain: initialized signer for address %s", signer.Address()))
	} else {
		slog.Info("chain: WARNING — no SUI_PRIVATE_KEY set, on-chain writes disabled")
	}

	return &Client{
		rpcURL:    rpcURL,
		packageID: packageID,
		signer:    signer,
	}
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
