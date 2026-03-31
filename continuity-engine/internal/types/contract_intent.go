package types

// ContractIntent is the structured output from the Super model's contract
// generation call. Fields use qualitative values that the resolver maps to
// exact on-chain parameters.
type ContractIntent struct {
	ContractType string `json:"contract_type"` // "coin_for_item", "item_for_coin", "item_for_item"
	OfferedItem  string `json:"offered_item"`  // item name (for item_for_coin, item_for_item) or empty
	WantedItem   string `json:"wanted_item"`   // item name (for coin_for_item, item_for_item) or empty
	CORMAmount   string `json:"corm_amount"`   // "small", "medium", "large" — modulates LUX-derived price
	Quantity     string `json:"quantity"`       // "small", "medium", "large" — % of available inventory
	Urgency      string `json:"urgency"`        // "low", "medium", "high" — maps to deadline
	AllowPartial bool   `json:"allow_partial"`
	Narrative    string `json:"narrative"` // flavor text for the contract announcement
}

// Contract type constants.
const (
	ContractCoinForItem  = "coin_for_item"
	ContractItemForCoin  = "item_for_coin"
	ContractItemForItem  = "item_for_item"
	ContractBuildSSU     = "build_ssu"      // legacy UI-only directive (fallback)
	ContractBuildRequest = "build_request"  // on-chain witnessed contract
)

// Valid contract types for Phase 2.
var ValidContractTypes = map[string]bool{
	ContractCoinForItem:  true,
	ContractItemForCoin:  true,
	ContractItemForItem:  true,
	ContractBuildSSU:     true,
	ContractBuildRequest: true,
}
