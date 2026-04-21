# Discovery: MapContext Refactor

## Problem Statement

The map overlay system introduced in `feat/web-map-overlays` does not produce visible star color changes when a filter is activated. Stars remain white regardless of which filter or render mode is selected.

## Root Cause

`SolarSystemPoints` manages three independent visual signals — base overlay color, glow, and selection highlight — through two competing `useEffect` hooks that share identical dependency arrays (`[overlayColors, idToIndex, selectedId]`). Both hooks always fire together, both write to the same GPU color buffer, and both maintain separate bookkeeping state via a shared `restoreColorRef` mutable ref. The result is that:

1. When an overlay is activated while a star is selected, Effect 2 restores the previously-selected star's pixel to a `restoreColorRef` value that was captured before the overlay existed — i.e., white — overwriting the correct region color that Effect 1 just applied.
2. Effect 1 redundantly re-paints the entire 24k-star buffer on every `selectedId` change.
3. The `restoreColorRef` ref is written by both effects, with the last-writer-wins outcome being unpredictable under React's effect ordering guarantees.

The fundamental issue is architectural: the component is trying to reconcile multiple state dimensions imperatively through side effects rather than deriving a single source of truth.

## Proposed Solution

Introduce a `MapContext` that owns all map screen state and exposes `finalStarColors` — the fully-composited RGB buffer (overlay base colors ⊕ gold selection highlight) — as a single `useMemo`-derived value. All map components that need visual state consume directly from the context. `SolarSystemPoints` becomes a pure GPU sync layer: one effect, one buffer write.

## Out of Scope

- Changes to overlay filter logic, palette, or data pipeline
- Changes to `GlowLayer` or `DensityGradientLayer` visual output
- Any new overlay filters or modes
- Persistence of overlay state across sessions
