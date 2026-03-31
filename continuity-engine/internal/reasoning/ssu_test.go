package reasoning

import (
	"errors"
	"strings"
	"testing"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

// --- HasValidSSU ---

func TestHasValidSSU_Empty(t *testing.T) {
	snap := chain.WorldSnapshot{NodeSSUs: nil}
	if HasValidSSU(snap) {
		t.Error("expected false for nil NodeSSUs")
	}
}

func TestHasValidSSU_ZeroAddress(t *testing.T) {
	snap := chain.WorldSnapshot{
		NodeSSUs: []chain.SSUInfo{
			{ObjectID: "0x0000000000000000000000000000000000000000000000000000000000000000"},
		},
	}
	if HasValidSSU(snap) {
		t.Error("expected false for zero-address SSU")
	}
}

func TestHasValidSSU_EmptyString(t *testing.T) {
	snap := chain.WorldSnapshot{
		NodeSSUs: []chain.SSUInfo{{ObjectID: ""}},
	}
	if HasValidSSU(snap) {
		t.Error("expected false for empty ObjectID")
	}
}

func TestHasValidSSU_ValidSSU(t *testing.T) {
	snap := chain.WorldSnapshot{
		NodeSSUs: []chain.SSUInfo{
			{ObjectID: "0x00000000000000000000000000000000000000000000000000005eed55000001"},
		},
	}
	if !HasValidSSU(snap) {
		t.Error("expected true for valid SSU")
	}
}

func TestHasValidSSU_MixedEntries(t *testing.T) {
	snap := chain.WorldSnapshot{
		NodeSSUs: []chain.SSUInfo{
			{ObjectID: ""},
			{ObjectID: "0x0000000000000000000000000000000000000000000000000000000000000000"},
			{ObjectID: "0xabc123def456789012345678901234567890123456789012345678901234abcd"},
		},
	}
	if !HasValidSSU(snap) {
		t.Error("expected true when at least one valid SSU exists")
	}
}

// --- ResolveIntent SSU validation ---

func TestResolveIntent_NoSSU_ReturnsErrNoSSU(t *testing.T) {
	// SSU check happens before item lookup, so an empty registry is fine.
	snapshot := chain.WorldSnapshot{NodeSSUs: nil}
	registry := chain.NewRegistry("", "")
	traits := &types.CormTraits{Patience: 0.5}

	for _, ct := range []string{types.ContractCoinForItem, types.ContractItemForCoin, types.ContractItemForItem} {
		intent := types.ContractIntent{ContractType: ct, Urgency: "medium"}
		_, err := ResolveIntent(intent, snapshot, registry, traits, PricingConfig{}, PlayerIdentity{})
		if !errors.Is(err, ErrNoSSU) {
			t.Errorf("%s: expected ErrNoSSU, got: %v", ct, err)
		}
	}
}

func TestResolveIntent_NoSSU_BuildSSU_Allowed(t *testing.T) {
	// build_ssu intents should NOT return ErrNoSSU.
	snapshot := chain.WorldSnapshot{NodeSSUs: nil}
	registry := chain.NewRegistry("", "")
	traits := &types.CormTraits{Patience: 0.5}

	intent := types.ContractIntent{ContractType: types.ContractBuildSSU, Urgency: "medium"}
	// build_ssu bypasses the SSU check and reaches the switch default (no-op).
	_, err := ResolveIntent(intent, snapshot, registry, traits, PricingConfig{}, PlayerIdentity{})
	if errors.Is(err, ErrNoSSU) {
		t.Error("build_ssu should not trigger ErrNoSSU")
	}
}

func TestResolveIntent_ZeroAddressSSU_ReturnsErrNoSSU(t *testing.T) {
	// A zero-address SSU should be treated as invalid.
	snapshot := chain.WorldSnapshot{
		NodeSSUs: []chain.SSUInfo{
			{ObjectID: "0x0000000000000000000000000000000000000000000000000000000000000000"},
		},
	}
	registry := chain.NewRegistry("", "")
	traits := &types.CormTraits{Patience: 0.5}

	intent := types.ContractIntent{ContractType: types.ContractCoinForItem, Urgency: "medium"}
	_, err := ResolveIntent(intent, snapshot, registry, traits, PricingConfig{}, PlayerIdentity{})
	if !errors.Is(err, ErrNoSSU) {
		t.Errorf("expected ErrNoSSU for zero-address SSU, got: %v", err)
	}
}

// --- Narrative helpers ---

func TestBuildSSUNarrative(t *testing.T) {
	text := BuildSSUNarrative()
	if !strings.Contains(text, "storage") {
		t.Errorf("expected 'storage' in narrative, got: %s", text)
	}
	if !strings.Contains(text, "deploy") {
		t.Errorf("expected 'deploy' in narrative, got: %s", text)
	}
}

func TestSSUDetectedAnnouncement(t *testing.T) {
	text := SSUDetectedAnnouncement()
	if !strings.Contains(text, "storage unit detected") {
		t.Errorf("expected 'storage unit detected' in announcement, got: %s", text)
	}
}

// --- genericNarrative for build_ssu ---

func TestGenericNarrative_BuildSSU(t *testing.T) {
	intent := &types.ContractIntent{ContractType: types.ContractBuildSSU}
	text := genericNarrative(intent)
	if !strings.Contains(text, "storage") {
		t.Errorf("expected build_ssu narrative, got: %s", text)
	}
}

func TestGenericNarrative_BuildRequest(t *testing.T) {
	intent := &types.ContractIntent{ContractType: types.ContractBuildRequest}
	text := genericNarrative(intent)
	if !strings.Contains(text, "storage") {
		t.Errorf("expected build_request to use same SSU narrative, got: %s", text)
	}
}

// --- buildSSUContractID determinism ---

func TestBuildSSUContractID_Deterministic(t *testing.T) {
	id1 := buildSSUContractID("corm-abc-123")
	id2 := buildSSUContractID("corm-abc-123")
	if id1 != id2 {
		t.Errorf("expected deterministic ID, got %s and %s", id1, id2)
	}
	if !strings.HasPrefix(id1, "build_ssu_") {
		t.Errorf("expected 'build_ssu_' prefix, got: %s", id1)
	}
}

// --- buildSSUActive map uses string values ---

func TestBuildSSUActive_StringMap(t *testing.T) {
	// Verify that the buildSSUActive map stores contract IDs as strings.
	buildSSUMu.Lock()
	defer buildSSUMu.Unlock()

	// Set an active build_ssu with a contract ID.
	testCorm := "test-corm-map-check"
	buildSSUActive[testCorm] = "0xcontract123"

	if buildSSUActive[testCorm] == "" {
		t.Error("expected non-empty contract ID")
	}
	if buildSSUActive[testCorm] != "0xcontract123" {
		t.Errorf("expected '0xcontract123', got: %s", buildSSUActive[testCorm])
	}

	// Non-existent corm returns empty string (falsy).
	if buildSSUActive["nonexistent"] != "" {
		t.Error("expected empty string for nonexistent corm")
	}

	// Clean up.
	delete(buildSSUActive, testCorm)
}

// --- ContractBuildRequest type validation ---

func TestContractBuildRequest_ValidType(t *testing.T) {
	if !types.ValidContractTypes[types.ContractBuildRequest] {
		t.Error("expected build_request to be a valid contract type")
	}
	if types.ContractBuildRequest != "build_request" {
		t.Errorf("expected 'build_request', got: %s", types.ContractBuildRequest)
	}
}
