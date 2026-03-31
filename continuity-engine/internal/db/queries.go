package db

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/frontier-corm/continuity-engine/internal/types"
)

// --- Session → Corm mapping ---

// ResolveSessionCorm returns the corm_id for a session, or empty string if not found.
func (d *DB) ResolveSessionCorm(ctx context.Context, environment, sessionID string) (string, error) {
	var cormID string
	err := d.Pool.QueryRow(ctx,
		"SELECT corm_id FROM corm_sessions WHERE environment = $1 AND session_id = $2",
		environment, sessionID,
	).Scan(&cormID)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return cormID, err
}

// LinkSessionCorm associates a session with a corm.
func (d *DB) LinkSessionCorm(ctx context.Context, environment, sessionID, cormID string) error {
	_, err := d.Pool.Exec(ctx,
		"INSERT INTO corm_sessions (environment, session_id, corm_id) VALUES ($1, $2, $3) ON CONFLICT (environment, session_id) DO NOTHING",
		environment, sessionID, cormID,
	)
	return err
}

// --- Network Node → Corm mapping ---

// ResolveCormID returns the corm_id for a network node, or empty string if not found.
func (d *DB) ResolveCormID(ctx context.Context, environment, networkNodeID string) (string, error) {
	var cormID string
	err := d.Pool.QueryRow(ctx,
		"SELECT corm_id FROM corm_network_nodes WHERE environment = $1 AND network_node_id = $2",
		environment, networkNodeID,
	).Scan(&cormID)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return cormID, err
}

// LinkNetworkNode associates a network node with a corm.
func (d *DB) LinkNetworkNode(ctx context.Context, environment, networkNodeID, cormID string) error {
	_, err := d.Pool.Exec(ctx,
		"INSERT INTO corm_network_nodes (environment, network_node_id, corm_id) VALUES ($1, $2, $3) ON CONFLICT (environment, network_node_id) DO NOTHING",
		environment, networkNodeID, cormID,
	)
	return err
}

// SetChainStateID stores the on-chain CormState object ID for a network node.
func (d *DB) SetChainStateID(ctx context.Context, environment, networkNodeID, chainStateID string) error {
	_, err := d.Pool.Exec(ctx,
		"UPDATE corm_network_nodes SET chain_state_id = $1 WHERE environment = $2 AND network_node_id = $3",
		chainStateID, environment, networkNodeID,
	)
	return err
}

// ResolveChainStateID returns the on-chain CormState object ID for a corm's
// primary network node. Falls back to the oldest node if no is_primary row
// exists. Returns empty string if no chain_state_id has been stored.
func (d *DB) ResolveChainStateID(ctx context.Context, environment, cormID string) (string, error) {
	var chainID *string
	err := d.Pool.QueryRow(ctx,
		`SELECT chain_state_id FROM corm_network_nodes
		 WHERE environment = $1 AND corm_id = $2 AND is_primary = true
		 LIMIT 1`,
		environment, cormID,
	).Scan(&chainID)
	if err == pgx.ErrNoRows {
		// Fallback: oldest node by linked_at
		err = d.Pool.QueryRow(ctx,
			`SELECT chain_state_id FROM corm_network_nodes
			 WHERE environment = $1 AND corm_id = $2
			 ORDER BY linked_at ASC
			 LIMIT 1`,
			environment, cormID,
		).Scan(&chainID)
		if err == pgx.ErrNoRows {
			return "", nil
		}
	}
	if err != nil {
		return "", err
	}
	if chainID == nil {
		return "", nil
	}
	return *chainID, nil
}

// ResolveNetworkNodeByCorm returns the primary network node ID for a corm.
// Falls back to the oldest node by linked_at if no is_primary row exists.
func (d *DB) ResolveNetworkNodeByCorm(ctx context.Context, environment, cormID string) (string, error) {
	var nodeID string
	err := d.Pool.QueryRow(ctx,
		`SELECT network_node_id FROM corm_network_nodes
		 WHERE environment = $1 AND corm_id = $2 AND is_primary = true
		 LIMIT 1`,
		environment, cormID,
	).Scan(&nodeID)
	if err == pgx.ErrNoRows {
		// Fallback: oldest node by linked_at (pre-migration data)
		err = d.Pool.QueryRow(ctx,
			`SELECT network_node_id FROM corm_network_nodes
			 WHERE environment = $1 AND corm_id = $2
			 ORDER BY linked_at ASC
			 LIMIT 1`,
			environment, cormID,
		).Scan(&nodeID)
		if err == pgx.ErrNoRows {
			return "", nil
		}
	}
	return nodeID, err
}

// --- Events ---

// InsertEvent appends a raw event and returns the assigned ID.
func (d *DB) InsertEvent(ctx context.Context, environment, cormID string, evt types.CormEvent) (int64, error) {
	var id int64
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO corm_events (environment, corm_id, network_node_id, session_id, player_address, event_type, payload)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		environment, cormID, evt.NetworkNodeID, evt.SessionID, evt.PlayerAddress, evt.EventType, evt.Payload,
	).Scan(&id)
	return id, err
}

// --- Traits ---

// GetTraits returns the learned traits for a corm, or nil if not found.
func (d *DB) GetTraits(ctx context.Context, environment, cormID string) (*types.CormTraits, error) {
	t := &types.CormTraits{CormID: cormID}
	var agendaJSON, affinityJSON, playerJSON []byte
	err := d.Pool.QueryRow(ctx,
		`SELECT phase, stability, corruption, agenda_weights, contract_type_affinity,
		        patience, paranoia, volatility, player_affinities, consolidation_checkpoint, updated_at
		 FROM corm_traits WHERE environment = $1 AND corm_id = $2`, environment, cormID,
	).Scan(
		&t.Phase, &t.Stability, &t.Corruption,
		&agendaJSON, &affinityJSON,
		&t.Patience, &t.Paranoia, &t.Volatility,
		&playerJSON, &t.ConsolidationCheckpoint, &t.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	json.Unmarshal(agendaJSON, &t.AgendaWeights)
	json.Unmarshal(affinityJSON, &t.ContractTypeAffinity)
	json.Unmarshal(playerJSON, &t.PlayerAffinities)

	return t, nil
}

// UpsertTraits creates or updates the traits row for a corm.
func (d *DB) UpsertTraits(ctx context.Context, environment string, t *types.CormTraits) error {
	agendaJSON, _ := json.Marshal(t.AgendaWeights)
	affinityJSON, _ := json.Marshal(t.ContractTypeAffinity)
	playerJSON, _ := json.Marshal(t.PlayerAffinities)

	_, err := d.Pool.Exec(ctx,
		`INSERT INTO corm_traits (environment, corm_id, phase, stability, corruption, agenda_weights,
		  contract_type_affinity, patience, paranoia, volatility, player_affinities,
		  consolidation_checkpoint, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
		 ON CONFLICT (environment, corm_id) DO UPDATE SET
		  phase=$3, stability=$4, corruption=$5, agenda_weights=$6,
		  contract_type_affinity=$7, patience=$8, paranoia=$9, volatility=$10,
		  player_affinities=$11, consolidation_checkpoint=$12, updated_at=now()`,
		environment, t.CormID, t.Phase, t.Stability, t.Corruption,
		agendaJSON, affinityJSON,
		t.Patience, t.Paranoia, t.Volatility,
		playerJSON, t.ConsolidationCheckpoint,
	)
	return err
}

// --- Responses ---

// InsertResponse logs a corm response.
func (d *DB) InsertResponse(ctx context.Context, environment string, r *types.CormResponse) error {
	_, err := d.Pool.Exec(ctx,
		`INSERT INTO corm_responses (environment, corm_id, session_id, action_type, payload)
		 VALUES ($1,$2,$3,$4,$5)`,
		environment, r.CormID, r.SessionID, r.ActionType, r.Payload,
	)
	return err
}

// RecentResponses returns the last N responses for a corm.
func (d *DB) RecentResponses(ctx context.Context, environment, cormID string, limit int) ([]types.CormResponse, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, corm_id, session_id, action_type, payload, created_at
		 FROM corm_responses WHERE environment = $1 AND corm_id = $2 ORDER BY id DESC LIMIT $3`,
		environment, cormID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var responses []types.CormResponse
	for rows.Next() {
		var r types.CormResponse
		if err := rows.Scan(&r.ID, &r.CormID, &r.SessionID, &r.ActionType, &r.Payload, &r.CreatedAt); err != nil {
			return nil, err
		}
		responses = append(responses, r)
	}
	return responses, rows.Err()
}

// RecentEvents
func (d *DB) RecentEvents(ctx context.Context, environment, cormID string, limit int) ([]types.CormEvent, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, network_node_id, session_id, player_address, event_type, payload, created_at
		 FROM corm_events WHERE environment = $1 AND corm_id = $2 ORDER BY id DESC LIMIT $3`,
		environment, cormID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("recent events: %w", err)
	}
	defer rows.Close()

	var events []types.CormEvent
	for rows.Next() {
		var e types.CormEvent
		var id int64
		if err := rows.Scan(&id, &e.NetworkNodeID, &e.SessionID, &e.PlayerAddress, &e.EventType, &e.Payload, &e.Timestamp); err != nil {
			return nil, err
		}
		e.Seq = uint64(id)
		events = append(events, e)
	}
	return events, rows.Err()
}
