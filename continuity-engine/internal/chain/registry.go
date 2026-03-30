package chain

import (
	"encoding/json"
	"log/slog"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// ItemType holds metadata for a single game item.
type ItemType struct {
	TypeID    uint64
	Name      string
	GroupName string
	Volume    float64
	LUXValue  float64 // 0 if unvalued
}

// Registry is a startup-loaded, read-only item type registry.
type Registry struct {
	byID   map[uint64]*ItemType
	byName map[string]*ItemType // lowercase name → item
	items  []*ItemType          // published items only
}

// NewRegistry loads the item type registry from disk.
// registryDir should contain types.json and groups.json.
// valuesPath points to item-values.json (may be empty/missing).
func NewRegistry(registryDir, valuesPath string) *Registry {
	r := &Registry{
		byID:   make(map[uint64]*ItemType),
		byName: make(map[string]*ItemType),
	}

	// Load types.json
	typesPath := filepath.Join(registryDir, "types.json")
	typesData, err := os.ReadFile(typesPath)
	if err != nil {
		slog.Info(fmt.Sprintf("registry: failed to read %s: %v", typesPath, err))
		return r
	}

	var rawTypes map[string]struct {
		TypeID    uint64  `json:"typeID"`
		TypeName  string  `json:"typeName"`
		GroupID   int     `json:"groupID"`
		Volume    float64 `json:"volume"`
		Published int     `json:"published"`
	}
	if err := json.Unmarshal(typesData, &rawTypes); err != nil {
		slog.Info(fmt.Sprintf("registry: failed to parse types.json: %v", err))
		return r
	}

	// Load groups.json
	groupsPath := filepath.Join(registryDir, "groups.json")
	groupsData, err := os.ReadFile(groupsPath)
	if err != nil {
		slog.Info(fmt.Sprintf("registry: failed to read %s: %v", groupsPath, err))
	}

	type groupEntry struct {
		GroupName string `json:"groupName"`
	}
	rawGroups := make(map[string]groupEntry)
	if groupsData != nil {
		json.Unmarshal(groupsData, &rawGroups)
	}

	// Load item-values.json (optional)
	luxValues := make(map[uint64]float64)
	if valuesPath != "" {
		valuesData, err := os.ReadFile(valuesPath)
		if err != nil {
			slog.Info(fmt.Sprintf("registry: item values not available (%s): %v — all items will use floor value", valuesPath, err))
		} else {
			var rawValues []struct {
				TypeID   uint64   `json:"typeId"`
				LUXValue *float64 `json:"luxValue"`
			}
			if err := json.Unmarshal(valuesData, &rawValues); err != nil {
				slog.Info(fmt.Sprintf("registry: failed to parse item-values.json: %v", err))
			} else {
				for _, v := range rawValues {
					if v.LUXValue != nil {
						luxValues[v.TypeID] = *v.LUXValue
					}
				}
				slog.Info(fmt.Sprintf("registry: loaded %d item valuations", len(luxValues)))
			}
		}
	}

	// Build registry (published items only)
	for _, raw := range rawTypes {
		if raw.Published != 1 {
			continue
		}

		groupID := raw.GroupID
		groupName := ""
		if g, ok := rawGroups[intToStr(groupID)]; ok {
			groupName = g.GroupName
		}

		item := &ItemType{
			TypeID:    raw.TypeID,
			Name:      raw.TypeName,
			GroupName: groupName,
			Volume:    raw.Volume,
			LUXValue:  luxValues[raw.TypeID],
		}

		r.byID[item.TypeID] = item
		r.byName[strings.ToLower(item.Name)] = item
		r.items = append(r.items, item)
	}

	slog.Info(fmt.Sprintf("registry: loaded %d published items (%d with LUX values)", len(r.items), len(luxValues)))
	return r
}

// LookupByID returns the item with the given type ID, or nil.
func (r *Registry) LookupByID(id uint64) *ItemType {
	return r.byID[id]
}

// LookupByName returns the item matching the name (case-insensitive exact match
// first, then substring match). Returns nil if not found.
func (r *Registry) LookupByName(name string) *ItemType {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" {
		return nil
	}

	// Exact match
	if item, ok := r.byName[lower]; ok {
		return item
	}

	// Substring match (first hit wins)
	for key, item := range r.byName {
		if strings.Contains(key, lower) {
			return item
		}
	}

	return nil
}

// AvailableItems returns all published items suitable for prompt injection.
func (r *Registry) AvailableItems() []*ItemType {
	return r.items
}

// ItemCount returns the number of items in the registry.
func (r *Registry) ItemCount() int {
	return len(r.items)
}

func intToStr(i int) string {
	return strconv.Itoa(i)
}
