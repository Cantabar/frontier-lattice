package chain

import (
	"testing"
)

func TestMaterialsNeeded_Reflex(t *testing.T) {
	r := NewRecipeRegistry()
	mats := r.MaterialsNeeded(87847, 1)

	// Reflex needs raw materials: Feldspar Crystals (77800), Silica Grains (89259),
	// Iron-Rich Nodules (89260), Palladium (99001), Fossilized Exotronics (83818).
	byID := make(map[uint64]int)
	for _, m := range mats {
		byID[m.TypeID] = m.Quantity
	}

	// Verify all expected raw materials are present.
	expected := map[uint64]string{
		77800: "Feldspar Crystals",
		89259: "Silica Grains",
		89260: "Iron-Rich Nodules",
		99001: "Palladium",
		83818: "Fossilized Exotronics",
	}
	for id, name := range expected {
		if byID[id] == 0 {
			t.Errorf("expected raw material %s (%d) in Reflex recipe, not found", name, id)
		}
	}

	// No intermediate IDs should appear.
	intermediates := []uint64{84182, 89258, 78418}
	for _, id := range intermediates {
		if byID[id] > 0 {
			t.Errorf("intermediate %d should not appear in flattened raw materials", id)
		}
	}
}

func TestMaterialsNeeded_Reiver(t *testing.T) {
	r := NewRecipeRegistry()
	mats := r.MaterialsNeeded(87848, 1)

	byID := make(map[uint64]int)
	for _, m := range mats {
		byID[m.TypeID] = m.Quantity
	}

	// Reiver needs: Feldspar Crystals, Silica Grains, Iron-Rich Nodules,
	// Palladium, Fossilized Exotronics.
	expected := []uint64{77800, 89259, 89260, 99001, 83818}
	for _, id := range expected {
		if byID[id] == 0 {
			t.Errorf("expected raw material %d in Reiver recipe, not found", id)
		}
	}
}

func TestMaterialsNeeded_UnknownItem(t *testing.T) {
	r := NewRecipeRegistry()
	mats := r.MaterialsNeeded(99999, 10)

	// Unknown item treated as raw material — returns itself.
	if len(mats) != 1 {
		t.Fatalf("expected 1 material for unknown item, got %d", len(mats))
	}
	if mats[0].TypeID != 99999 || mats[0].Quantity != 10 {
		t.Errorf("expected {99999, 10}, got {%d, %d}", mats[0].TypeID, mats[0].Quantity)
	}
}

func TestIsRawMaterial(t *testing.T) {
	r := NewRecipeRegistry()

	if !r.IsRawMaterial(77800) {
		t.Error("Feldspar Crystals (77800) should be raw material")
	}
	if !r.IsRawMaterial(89259) {
		t.Error("Silica Grains (89259) should be raw material")
	}
	if r.IsRawMaterial(84182) {
		t.Error("Reinforced Alloys (84182) should NOT be raw material")
	}
	if r.IsRawMaterial(87847) {
		t.Error("Reflex (87847) should NOT be raw material")
	}
}

func TestLookup(t *testing.T) {
	r := NewRecipeRegistry()

	if rec := r.Lookup(87847); rec == nil || rec.OutputName != "Reflex" {
		t.Error("expected to find Reflex recipe")
	}
	if rec := r.Lookup(99999); rec != nil {
		t.Error("expected nil for unknown type")
	}
}
