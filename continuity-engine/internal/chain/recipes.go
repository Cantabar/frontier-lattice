package chain

// RecipeInput is a single material requirement.
type RecipeInput struct {
	TypeID   uint64
	Name     string
	Quantity int
}

// Recipe describes how to produce an item from inputs.
type Recipe struct {
	OutputTypeID   uint64
	OutputName     string
	OutputQuantity int
	Inputs         []RecipeInput
	Facility       string
}

// RecipeRegistry holds the curated recipe graph for goal-directed contracts.
type RecipeRegistry struct {
	recipes map[uint64]*Recipe // outputTypeID → recipe
}

// NewRecipeRegistry builds the hardcoded recipe graph for target ships and
// their full dependency trees.
func NewRecipeRegistry() *RecipeRegistry {
	r := &RecipeRegistry{recipes: make(map[uint64]*Recipe)}

	// --- Raw ore refinement ---

	// Feldspar Crystals → Hydrocarbon Residue (Field Refinery)
	r.recipes[89258] = &Recipe{
		OutputTypeID: 89258, OutputName: "Hydrocarbon Residue", OutputQuantity: 5,
		Inputs:   []RecipeInput{{TypeID: 77800, Name: "Feldspar Crystals", Quantity: 20}},
		Facility: "Field Refinery",
	}

	// --- Intermediate components (Field Printer) ---

	// Reinforced Alloys: Silica Grains + Iron-Rich Nodules + Palladium
	r.recipes[84182] = &Recipe{
		OutputTypeID: 84182, OutputName: "Reinforced Alloys", OutputQuantity: 8,
		Inputs: []RecipeInput{
			{TypeID: 89259, Name: "Silica Grains", Quantity: 105},
			{TypeID: 89260, Name: "Iron-Rich Nodules", Quantity: 70},
			{TypeID: 99001, Name: "Palladium", Quantity: 70},
		},
		Facility: "Field Printer",
	}

	// Carbon Weave: Hydrocarbon Residue
	r.recipes[84210] = &Recipe{
		OutputTypeID: 84210, OutputName: "Carbon Weave", OutputQuantity: 14,
		Inputs:   []RecipeInput{{TypeID: 89258, Name: "Hydrocarbon Residue", Quantity: 350}},
		Facility: "Field Printer",
	}

	// Thermal Composites: Hydrocarbon Residue + Silica Grains
	r.recipes[88561] = &Recipe{
		OutputTypeID: 88561, OutputName: "Thermal Composites", OutputQuantity: 14,
		Inputs: []RecipeInput{
			{TypeID: 89258, Name: "Hydrocarbon Residue", Quantity: 140},
			{TypeID: 89259, Name: "Silica Grains", Quantity: 90},
		},
		Facility: "Field Printer",
	}

	// Nomad Program Frame: Fossilized Exotronics
	r.recipes[78418] = &Recipe{
		OutputTypeID: 78418, OutputName: "Nomad Program Frame", OutputQuantity: 1,
		Inputs:   []RecipeInput{{TypeID: 83818, Name: "Fossilized Exotronics", Quantity: 5}},
		Facility: "Field Printer",
	}

	// --- Ships ---

	// Reflex (BP 1009): Mini Berth / Field Printer
	r.recipes[87847] = &Recipe{
		OutputTypeID: 87847, OutputName: "Reflex", OutputQuantity: 1,
		Inputs: []RecipeInput{
			{TypeID: 78418, Name: "Nomad Program Frame", Quantity: 1},
			{TypeID: 84182, Name: "Reinforced Alloys", Quantity: 28},
			{TypeID: 89258, Name: "Hydrocarbon Residue", Quantity: 40},
		},
		Facility: "Mini Berth",
	}

	// Reiver (BP 1224): Mini Berth
	r.recipes[87848] = &Recipe{
		OutputTypeID: 87848, OutputName: "Reiver", OutputQuantity: 1,
		Inputs: []RecipeInput{
			{TypeID: 78418, Name: "Nomad Program Frame", Quantity: 2},
			{TypeID: 84210, Name: "Carbon Weave", Quantity: 33},
			{TypeID: 88561, Name: "Thermal Composites", Quantity: 33},
			{TypeID: 84182, Name: "Reinforced Alloys", Quantity: 78},
		},
		Facility: "Mini Berth",
	}

	return r
}

// Lookup returns the recipe for a given output type ID, or nil.
func (r *RecipeRegistry) Lookup(typeID uint64) *Recipe {
	return r.recipes[typeID]
}

// MaterialsNeeded recursively flattens the recipe tree for a target item,
// scaling quantities appropriately. Returns the leaf-level raw materials
// (items with no recipe in the registry). Results are aggregated by TypeID.
func (r *RecipeRegistry) MaterialsNeeded(targetTypeID uint64, quantity int) []RecipeInput {
	agg := make(map[uint64]*RecipeInput)
	r.flatten(targetTypeID, quantity, agg)

	out := make([]RecipeInput, 0, len(agg))
	for _, m := range agg {
		out = append(out, *m)
	}
	return out
}

// flatten recursively walks the recipe tree, accumulating raw materials.
func (r *RecipeRegistry) flatten(typeID uint64, quantity int, agg map[uint64]*RecipeInput) {
	recipe := r.recipes[typeID]
	if recipe == nil {
		// Leaf node — this is a raw material.
		if existing, ok := agg[typeID]; ok {
			existing.Quantity += quantity
		} else {
			// We don't have a name here; caller should resolve via registry.
			agg[typeID] = &RecipeInput{TypeID: typeID, Quantity: quantity}
		}
		return
	}

	// How many batches of this recipe do we need?
	batches := (quantity + recipe.OutputQuantity - 1) / recipe.OutputQuantity

	for _, input := range recipe.Inputs {
		needed := input.Quantity * batches
		child := r.recipes[input.TypeID]
		if child == nil {
			// Raw material — accumulate.
			if existing, ok := agg[input.TypeID]; ok {
				existing.Quantity += needed
				// Preserve name if we have it.
			} else {
				agg[input.TypeID] = &RecipeInput{
					TypeID:   input.TypeID,
					Name:     input.Name,
					Quantity: needed,
				}
			}
		} else {
			// Intermediate — recurse.
			r.flatten(input.TypeID, needed, agg)
		}
	}
}

// IsRawMaterial returns true if the given type ID has no recipe in the
// registry (i.e. it must be gathered/mined directly).
func (r *RecipeRegistry) IsRawMaterial(typeID uint64) bool {
	_, hasRecipe := r.recipes[typeID]
	return !hasRecipe
}

// AllRecipes returns all recipes in the registry.
func (r *RecipeRegistry) AllRecipes() []*Recipe {
	out := make([]*Recipe, 0, len(r.recipes))
	for _, rec := range r.recipes {
		out = append(out, rec)
	}
	return out
}
