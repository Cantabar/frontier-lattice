package db

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/pgvector/pgvector-go"

	"github.com/frontier-corm/corm-brain/internal/types"
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

// EventsSince returns events for a corm with id > afterID.
func (d *DB) EventsSince(ctx context.Context, environment, cormID string, afterID int64) ([]types.CormEvent, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, corm_id, network_node_id, session_id, player_address, event_type, payload, created_at
		 FROM corm_events WHERE environment = $1 AND corm_id = $2 AND id > $3 ORDER BY id`,
		environment, cormID, afterID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []types.CormEvent
	for rows.Next() {
		var e types.CormEvent
		var id int64
		if err := rows.Scan(&id, &e.NetworkNodeID, &e.NetworkNodeID, &e.SessionID, &e.PlayerAddress, &e.EventType, &e.Payload, &e.Timestamp); err != nil {
			return nil, err
		}
		e.Seq = uint64(id)
		events = append(events, e)
	}
	return events, rows.Err()
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

// --- Memories ---

// InsertMemory stores an episodic memory with its embedding.
func (d *DB) InsertMemory(ctx context.Context, environment string, m *types.CormMemory) (int64, error) {
	sourceJSON, _ := json.Marshal(m.SourceEvents)
	var emb *pgvector.Vector
	if len(m.Embedding) > 0 {
		v := pgvector.NewVector(m.Embedding)
		emb = &v
	}

	var id int64
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO corm_memories (environment, corm_id, memory_text, memory_type, importance, source_events, embedding)
		 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
		environment, m.CormID, m.MemoryText, m.MemoryType, m.Importance, sourceJSON, emb,
	).Scan(&id)
	return id, err
}

// SearchMemories performs a pgvector similarity search for a corm's episodic memories.
// Returns top-k memories ranked by: 0.5*similarity + 0.3*importance + 0.2*recency.
func (d *DB) SearchMemories(ctx context.Context, environment, cormID string, queryEmbedding []float32, topK int) ([]types.CormMemory, error) {
	qvec := pgvector.NewVector(queryEmbedding)

	rows, err := d.Pool.Query(ctx,
		`SELECT id, corm_id, memory_text, memory_type, importance, source_events, created_at, last_recalled_at,
		        1 - (embedding <=> $1) AS similarity
		 FROM corm_memories
		 WHERE environment = $2 AND corm_id = $3 AND embedding IS NOT NULL
		 ORDER BY
		   0.5 * (1 - (embedding <=> $1)) +
		   0.3 * importance +
		   0.2 * (1.0 / (1.0 + EXTRACT(EPOCH FROM (now() - last_recalled_at)) / 86400.0))
		 DESC
		 LIMIT $4`,
		qvec, environment, cormID, topK,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var memories []types.CormMemory
	for rows.Next() {
		var m types.CormMemory
		var sourceJSON []byte
		var similarity float64
		if err := rows.Scan(&m.ID, &m.CormID, &m.MemoryText, &m.MemoryType, &m.Importance, &sourceJSON, &m.CreatedAt, &m.LastRecalledAt, &similarity); err != nil {
			return nil, err
		}
		json.Unmarshal(sourceJSON, &m.SourceEvents)
		memories = append(memories, m)
	}
	return memories, rows.Err()
}

// MemoryCount returns the number of memories for a corm.
func (d *DB) MemoryCount(ctx context.Context, environment, cormID string) (int, error) {
	var count int
	err := d.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM corm_memories WHERE environment = $1 AND corm_id = $2", environment, cormID).Scan(&count)
	return count, err
}

// PruneMemories deletes the lowest-ranked memories exceeding the cap.
func (d *DB) PruneMemories(ctx context.Context, environment, cormID string, cap int) (int64, error) {
	tag, err := d.Pool.Exec(ctx,
		`DELETE FROM corm_memories WHERE id IN (
		   SELECT id FROM corm_memories WHERE environment = $1 AND corm_id = $2
		   ORDER BY importance ASC, last_recalled_at ASC
		   LIMIT (SELECT GREATEST(COUNT(*) - $3, 0) FROM corm_memories WHERE environment = $1 AND corm_id = $2)
		 )`, environment, cormID, cap,
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// TouchMemories updates last_recalled_at for retrieved memories.
func (d *DB) TouchMemories(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := d.Pool.Exec(ctx,
		"UPDATE corm_memories SET last_recalled_at = now() WHERE id = ANY($1)", ids,
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

// ActiveCormIDs returns corm IDs with unconsolidated events for a given environment.
func (d *DB) ActiveCormIDs(ctx context.Context, environment string) ([]string, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT DISTINCT t.corm_id FROM corm_traits t
		 WHERE t.environment = $1 AND EXISTS (
		   SELECT 1 FROM corm_events e WHERE e.environment = $1 AND e.corm_id = t.corm_id AND e.id > t.consolidation_checkpoint
		 )`,
		environment,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// RecentEvents returns the last N events for a corm.
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
