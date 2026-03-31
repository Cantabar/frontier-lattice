package chain

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/pattonkan/sui-go/sui"
	"github.com/pattonkan/sui-go/suisigner"
	"github.com/pattonkan/sui-go/suisigner/suicrypto"
)

// Signer manages an Ed25519 keypair for signing SUI transactions.
type Signer struct {
	inner *suisigner.Signer
}

// NewSigner creates a signer from a hex-encoded private key seed (32 bytes).
func NewSigner(privateKey string) (*Signer, error) {
	pk := strings.TrimSpace(privateKey)
	pk = strings.TrimPrefix(pk, "0x")
	seed, err := hex.DecodeString(pk)
	if err != nil {
		return nil, fmt.Errorf("decode hex private key: %w", err)
	}
	if len(seed) < 32 {
		return nil, fmt.Errorf("private key seed too short: %d bytes (need 32)", len(seed))
	}
	s := suisigner.NewSigner(seed[:32], suicrypto.KeySchemeFlagEd25519)
	return &Signer{inner: s}, nil
}

// Address returns the SUI address derived from the keypair.
func (s *Signer) Address() *sui.Address {
	return s.inner.Address
}

// AddressString returns the SUI address as a hex string.
func (s *Signer) AddressString() string {
	return s.inner.Address.String()
}

// Inner returns the underlying suisigner.Signer for direct use with
// suiclient.SignAndExecuteTransaction.
func (s *Signer) Inner() *suisigner.Signer {
	return s.inner
}
