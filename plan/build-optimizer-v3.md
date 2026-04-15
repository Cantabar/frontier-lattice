# Description
This feature will be for a build optimizer in the web app. The optimizer should allow the user to select a blueprint from a blueprint browser menu ( re-use the existing blueprint browser
modal ). The selected blueprint will need to be back traced all to each input until reaching the raw material used. For each blueprint, the inputs should be evaluated to see what already exists in available SSUs ( re-use the existing SSU selection dropdown and checkboxes from the existing blueprint browser ).
The visual should be built on a canvas.
The flow of the visual should be from the bottom to the top. Raw materials -> intermediates -> Final product.
The Raw materials should be alone on a row at the bottom.
Rather than listing each material individually, use a card for each blueprint.
    The blueprint card should have icons with hover state for each of the inputs and outputs.
    It should display how many inputs are needed and how many outputs will be produced.
    Each input should be aligned with space between the elements and a dot close to the bottom edge of the card.
    Each output should be aligned with space between at the top with a dot on the edge of the card.
    The name of the blueprint should be in the center along with the facility used to run the blueprint.
Each output should have an arrow with a bezier curve drawn from the output dot to the input dots of the blueprints that need the matching materials.
In the event SSU resources are used, a new card should exist labeled SSU in the middle, then above that the icon of the needed resource with a dot along the top edge.
SSU resources should be consumed first, then any remaining should be filled with outputs of blueprints.
There should be generous space between rows to allow for arrow routing.

# Questions
Clarifying Questions

  1. Tab placement
  Is this a new "Canvas" tab in ForgePlanner (alongside Blueprints / Planner / Orders), or does it replace the existing Planner tab?
    This will replace the Planner tab. The order section of the tab should be removed as well.

  2. Quantity input
  Does the user specify how many of the final product they want (like the current optimizer's quantity field), or does the canvas show a single-run view?
    yes, it should be possible for the user to specify a quantity.

  3. Raw material nodes
  Raw materials (leaf nodes with no blueprint) — should they appear as simple icon + name labels/pills at the bottom row, or as a simplified card (no dots, no connections)?
    They should appear in a new card type labeled "Mining {ore name}" Above the label should be the icons for the ore as an output with a total amount and a dot along the top edge.

  4. Alternative blueprint selection
  When multiple blueprints can produce the same intermediate item, should the user be able to switch between them on the canvas (like the current dropdown in the tree view)?
    Let's leave alternative blueprint selection to the Field vs base toggle.

  5. SSU card structure (need confirmation)
  The spec says: "a new card should exist labeled SSU in the middle, then above that the icon of the needed resource with a dot along the top edge."

  I'm reading this as: the SSU card body sits in its row, and the resource icons float/sit at the top of the card (as outputs), each with a dot at the top edge connecting upward to consuming blueprint input dots. Is that correct, or did you mean the resource icons are separate elements sitting above the card body with space between?
    Your read is correct, the SSU card should contain the resource icons with the dot in the same fashion as the blueprint cards.

  6. Canvas interaction
  Static render only, or should the canvas support pan + zoom (especially important for large multi-level trees)?
    pan and zoom should be supported

  7. Quantities on cards
  Should cards show total quantities for the required number of runs (e.g., "120 Iron" for 3 runs × 40/run), or per-run quantities with a run count badge?
    show the total then in parentheses indicate ( n runs x n/run )

  8. Implementation: "canvas"
  Did you mean a literal HTML <canvas> element, or an SVG-overlay approach (absolutely-positioned React cards with an SVG layer for bezier curves on top)? SVG overlay is far more practical
  here given the interactive hover states and icon components. Happy to go either way but want to confirm intent.
    let's try SVG-overlay
