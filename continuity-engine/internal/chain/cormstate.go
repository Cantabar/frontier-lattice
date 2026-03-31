package chain

import (
	"context"
	"fmt"
	"log/slog"

	"encoding/json"

	"github.com/fardream/go-bcs/bcs"
	"github.com/pattonkan/sui-go/sui"
	"github.com/pattonkan/sui-go/sui/suiptb"
	"github.com/pattonkan/sui-go/suiclient"
	"github.com/pattonkan/sui-go/suisigner"
)

// CormStateOnChain represents the on-chain CormState object fields.
type CormStateOnChain struct {
	ObjectID      string
	NetworkNodeID string
	Phase         int
	Stability     int
	Corruption    int
}

// CreateCormState provisions a new CormState shared object on-chain via
// corm_state::install(config, network_node_id). The MintCap is auto-transferred
// to the brain address stored in CormConfig.
// Returns the new CormState object ID.
func (c *Client) CreateCormState(ctx context.Context, networkNodeID string) (string, error) {
	if networkNodeID == "" {
		return "", fmt.Errorf("network_node_id is required")
	}
	if !c.HasSigner() {
		return "", fmt.Errorf("no signer configured")
	}
	if c.cormStatePkg == nil || c.cormConfigObjID == nil {
		// Fall back to stub if not configured
		prefix := networkNodeID
		if len(prefix) > 8 {
			prefix = prefix[:8]
		}
		cormID := fmt.Sprintf("corm_%s", prefix)
		slog.Info(fmt.Sprintf("chain: stub CreateCormState for node %s → %s (missing package/config IDs)", networkNodeID, cormID))
		return cormID, nil
	}

	nodeID, err := sui.ObjectIdFromHex(networkNodeID)
	if err != nil {
		return "", fmt.Errorf("invalid network_node_id: %w", err)
	}

	// Look up CormConfig's initial shared version
	configRef, err := c.getSharedObjectRef(ctx, c.cormConfigObjID)
	if err != nil {
		return "", fmt.Errorf("get CormConfig ref: %w", err)
	}

	// Build PTB: corm_state::install(config, network_node_id)
	ptb := suiptb.NewTransactionDataTransactionBuilder()

	configArg := ptb.MustObj(suiptb.ObjectArg{
		SharedObject: configRef.SharedObjectArg(false), // install takes &CormConfig (immutable ref)
	})
	nodeArg := ptb.MustPure(nodeID)

	ptb.ProgrammableMoveCall(
		c.cormStatePkg,
		"corm_state",
		"install",
		[]sui.TypeTag{},
		[]suiptb.Argument{configArg, nodeArg},
	)

	resp, err := c.signAndExecute(ctx, ptb)
	if err != nil {
		return "", fmt.Errorf("execute install: %w", err)
	}

	// Extract CormState object ID from ObjectChanges (Created + shared)
	cormStateID := ""
	for _, change := range resp.ObjectChanges {
		if change.Data.Created != nil {
			// The CormState is a shared object — check if objectType contains "corm_state::CormState"
			if containsStr(string(change.Data.Created.ObjectType), "corm_state::CormState") {
				cormStateID = change.Data.Created.ObjectId.String()
				break
			}
		}
	}

	if cormStateID == "" {
		return "", fmt.Errorf("CormState object not found in transaction effects")
	}

	slog.Info(fmt.Sprintf("chain: CreateCormState for node %s → %s", networkNodeID, cormStateID))
	return cormStateID, nil
}

// GetCormState reads a CormState shared object from chain via RPC.
func (c *Client) GetCormState(ctx context.Context, cormID string) (*CormStateOnChain, error) {
	if c.seedMode {
		return nil, nil
	}

	objID, err := sui.ObjectIdFromHex(cormID)
	if err != nil {
		return nil, fmt.Errorf("invalid corm ID: %w", err)
	}

	resp, err := c.rpc.GetObject(ctx, &suiclient.GetObjectRequest{
		ObjectId: objID,
		Options: &suiclient.SuiObjectDataOptions{
			ShowContent: true,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get object: %w", err)
	}
	if resp.Data == nil || resp.Data.Content == nil {
		return nil, nil // not found
	}

	// Parse fields from the MoveObject content
	if resp.Data.Content.Data.MoveObject == nil {
		return nil, fmt.Errorf("content is not a MoveObject")
	}
	var fields map[string]interface{}
	if err := json.Unmarshal(resp.Data.Content.Data.MoveObject.Fields, &fields); err != nil {
		return nil, fmt.Errorf("parse content fields: %w", err)
	}

	state := &CormStateOnChain{
		ObjectID: cormID,
	}
	if v, ok := fields["phase"]; ok {
		state.Phase = toInt(v)
	}
	if v, ok := fields["stability"]; ok {
		state.Stability = toInt(v)
	}
	if v, ok := fields["corruption"]; ok {
		state.Corruption = toInt(v)
	}
	if v, ok := fields["network_node_id"]; ok {
		state.NetworkNodeID = fmt.Sprint(v)
	}

	return state, nil
}

// UpdateCormState updates phase/stability/corruption on-chain via
// corm_state::update_state. Only the admin (brain keypair) can call this.
func (c *Client) UpdateCormState(ctx context.Context, cormID string, phase int, stability, corruption float64) error {
	if !c.HasSigner() {
		return fmt.Errorf("no signer configured")
	}
	if c.cormStatePkg == nil {
		slog.Info(fmt.Sprintf("chain: stub UpdateCormState %s → phase=%d stab=%.0f corr=%.0f (no package ID)", cormID, phase, stability, corruption))
		return nil
	}

	objID, err := sui.ObjectIdFromHex(cormID)
	if err != nil {
		return fmt.Errorf("invalid corm ID: %w", err)
	}

	stateRef, err := c.getSharedObjectRef(ctx, objID)
	if err != nil {
		return fmt.Errorf("get CormState ref: %w", err)
	}

	// Build PTB: corm_state::update_state(state, phase, stability, corruption)
	ptb := suiptb.NewTransactionDataTransactionBuilder()

	stateArg := ptb.MustObj(suiptb.ObjectArg{
		SharedObject: stateRef.SharedObjectArg(true),
	})
	phaseArg := ptb.MustPure(uint8(phase))
	stabArg := ptb.MustPure(uint64(stability))
	corrArg := ptb.MustPure(uint64(corruption))

	ptb.ProgrammableMoveCall(
		c.cormStatePkg,
		"corm_state",
		"update_state",
		[]sui.TypeTag{},
		[]suiptb.Argument{stateArg, phaseArg, stabArg, corrArg},
	)

	if _, err := c.signAndExecute(ctx, ptb); err != nil {
		return fmt.Errorf("execute update_state: %w", err)
	}

	slog.Info(fmt.Sprintf("chain: UpdateCormState %s → phase=%d stab=%.0f corr=%.0f", cormID, phase, stability, corruption))
	return nil
}

// --- Shared helpers ---

// getSharedObjectRef fetches the object's version info needed for SharedObjectArg.
// Must request ShowOwner to populate Owner.Shared.InitialSharedVersion.
func (c *Client) getSharedObjectRef(ctx context.Context, objID *sui.ObjectId) (*suiclient.SuiObjectData, error) {
	resp, err := c.rpc.GetObject(ctx, &suiclient.GetObjectRequest{
		ObjectId: objID,
		Options:  &suiclient.SuiObjectDataOptions{ShowOwner: true},
	})
	if err != nil {
		return nil, err
	}
	if resp.Data == nil {
		return nil, fmt.Errorf("object %s not found", objID)
	}
	return resp.Data, nil
}

// signAndExecute builds transaction bytes from a PTB, signs them, and executes.
func (c *Client) signAndExecute(
	ctx context.Context,
	ptb *suiptb.ProgrammableTransactionBuilder,
) (*suiclient.SuiTransactionBlockResponse, error) {
	pt := ptb.Finish()

	// Build transaction data
	txData := suiptb.NewTransactionData(
		c.signer.Address(),
		pt,
		nil, // gas payment (auto-select)
		50_000_000, // gas budget (50M MIST = 0.05 SUI)
		1000, // gas price (reference)
	)

	// BCS-encode the transaction data
	txBytes, err := bcs.Marshal(txData)
	if err != nil {
		return nil, fmt.Errorf("marshal tx data: %w", err)
	}

	// Sign
	digest, err := txData.SigningDigest()
	if err != nil {
		return nil, fmt.Errorf("signing digest: %w", err)
	}
	sig, err := c.signer.Inner().Sign(digest)
	if err != nil {
		return nil, fmt.Errorf("sign tx: %w", err)
	}

	// Execute
	resp, err := c.rpc.ExecuteTransactionBlock(ctx, &suiclient.ExecuteTransactionBlockRequest{
		TxDataBytes: txBytes,
		Signatures:  []*suisigner.Signature{sig},
		Options: &suiclient.SuiTransactionBlockResponseOptions{
			ShowEffects:       true,
			ShowObjectChanges: true,
			ShowEvents:        true,
		},
		RequestType: suiclient.TxnRequestTypeWaitForLocalExecution,
	})
	if err != nil {
		return nil, fmt.Errorf("execute tx: %w", err)
	}
	if resp.Effects != nil && resp.Effects.Data.V1 != nil {
		if resp.Effects.Data.V1.Status.Status != suiclient.ExecutionStatusSuccess {
			return resp, fmt.Errorf("transaction failed: %s", resp.Effects.Data.V1.Status.Error)
		}
	}
	return resp, nil
}

// toInt converts an interface{} (typically float64 from JSON) to int.
func toInt(v interface{}) int {
	switch val := v.(type) {
	case float64:
		return int(val)
	case int:
		return val
	case string:
		var n int
		fmt.Sscanf(val, "%d", &n)
		return n
	}
	return 0
}

// containsStr checks if s contains substr.
func containsStr(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && findSubstr(s, substr))
}

func findSubstr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
