# [frontier-corm][web] Build Canvas Card Hover/Selection Highlight

## Goal

When a card is hovered or clicked, visually emphasise that card and all directly connected cards and belts by dimming everything else. Clicking a card should lock the highlight; a second click (or clicking the background) should clear it.

---

## Design

### Visual behaviour

| State | This card | Connected cards | Connected belts | Unrelated cards | Unrelated belts |
|-------|-----------|-----------------|-----------------|-----------------|-----------------|
| Nothing selected | normal | normal | normal | normal | normal |
| Card hovered (no selection) | full opacity + subtle ring | full opacity | full opacity | opacity 0.25 | opacity 0.15 |
| Card clicked (selected) | full opacity + bright ring | full opacity | full opacity | opacity 0.25 | opacity 0.15 |
| Hovering a different card while one is selected | hover takes precedence | — | — | — | — |

"Connected" = any card that shares at least one `CanvasEdge` with the focused card (upstream or downstream).

---

## Implementation Plan

### Step 1 — Selection context  
**File:** new `web/src/components/forge/canvas/CanvasSelectionContext.tsx`

```ts
interface CanvasSelectionState {
  hoveredCardId: string | null;
  selectedCardId: string | null;
  // Derived from whichever is active (hover beats selection when both present)
  focusedCardId: string | null;
}
interface CanvasSelectionActions {
  onCardPointerEnter(cardId: string): void;
  onCardPointerLeave(cardId: string): void;
  onCardClick(cardId: string): void;
  onBackgroundClick(): void;
}
```

Expose a `useCanvasSelection()` hook and a `CanvasSelectionProvider` component.  
`focusedCardId = hoveredCardId ?? selectedCardId`.

---

### Step 2 — Edge adjacency index  
**File:** `web/src/lib/buildCanvasLayout.ts` (or co-located helper)

Add a pure function:

```ts
export function buildEdgeIndex(edges: CanvasEdge[]): Map<string, Set<string>> {
  // cardId → Set of directly connected cardIds (both directions)
}
```

Also derive the set of belt IDs connected to a card:

```ts
export function connectedBeltIds(
  cardId: string,
  edges: CanvasEdge[],
  belts: Belt[]
): Set<string>
```

A belt is connected if `belt.sourceCardId === cardId` or any segment's destination card is `cardId` (inferred from the corresponding edge).

---

### Step 3 — Wire context into BuildCanvas  
**File:** `web/src/components/forge/canvas/BuildCanvas.tsx`

1. Wrap the entire canvas in `<CanvasSelectionProvider>`.  
2. Compute `edgeIndex` and `connectedBeltIds` once via `useMemo` when `layout.edges` or `belts` change.  
3. Pass the `onBackgroundClick` handler to the background `<div>` (the pan target), guarding against firing during a pan drag.

---

### Step 4 — Per-card highlight props  
**Files:** `BlueprintCard.tsx`, `SsuCard.tsx`, `MiningCard.tsx`

Add props:

```ts
interface CardHighlightProps {
  dimmed: boolean;   // opacity 0.25, pointer-events: none
  focused: boolean;  // bright ring / glow
}
```

Apply via inline style or Tailwind classes (consistent with existing card styling):

```ts
style={{
  opacity: dimmed ? 0.25 : 1,
  transition: 'opacity 0.15s ease',
  outline: focused ? '2px solid rgba(255,255,255,0.7)' : 'none',
  outlineOffset: '3px',
}}
```

Cards call `onCardPointerEnter` / `onCardPointerLeave` / `onCardClick` from `useCanvasSelection()` in their own handlers.

---

### Step 5 — Per-belt highlight props  
**File:** `web/src/components/forge/canvas/EdgeSvg.tsx` (or wherever `<polyline>` is rendered inside BuildCanvas)

The belt renderer already receives `belts: Belt[]`. Extend the render loop:

```tsx
const { focusedCardId } = useCanvasSelection();
const dimBelt = focusedCardId !== null && !connectedBeltIdSet.has(belt.id);

<polyline
  ...
  style={{
    opacity: dimBelt ? 0.1 : 0.85,
    transition: 'opacity 0.15s ease',
  }}
/>
```

`connectedBeltIdSet` is passed down from BuildCanvas (computed in Step 3).

---

### Step 6 — CardLayer wiring  
**File:** `web/src/components/forge/canvas/BuildCanvas.tsx` (CardLayer section)

For each card in the layout, compute `dimmed` and `focused` before rendering:

```ts
const dimmed =
  focusedCardId !== null &&
  focusedCardId !== card.id &&
  !adjacentCardIds.has(card.id);

const focused = focusedCardId === card.id;
```

Pass these as props to the card component.

---

## Files Touched

| File | Change |
|------|--------|
| `canvas/CanvasSelectionContext.tsx` | **new** — context + hook |
| `lib/buildCanvasLayout.ts` | add `buildEdgeIndex`, `connectedBeltIds` helpers |
| `canvas/BuildCanvas.tsx` | wrap provider, compute adjacency, wire handlers |
| `canvas/BlueprintCard.tsx` | accept + apply `dimmed`/`focused` props |
| `canvas/SsuCard.tsx` | same |
| `canvas/MiningCard.tsx` | same |
| `canvas/EdgeSvg.tsx` (or inline SVG) | apply belt opacity |

No changes to ForgePlanner.tsx, BuildCanvasView.tsx, or the bus router.

---

## Edge Cases

- **Drag vs. click:** `onCardClick` must only fire when mouse-up delta < ~4px (no pan occurred). BuildCanvas already tracks `isDragging`; thread that into card click guards.
- **Mobile / pointer coarse:** skip hover-only states and treat everything as click-based.
- **Empty canvas:** no-op when `focusedCardId` is null.
- **Multi-output blueprints (refineries):** a single card may produce several materials — all belts from that card are highlighted together, which is the correct behaviour since they share a source card.
- **SSU / Mining cards as terminal sources:** they appear as connected to anything they feed; they receive `focused` or `dimmed` correctly since the edge index is bidirectional.

---

## Open Questions

1. Should hovering a **belt** also highlight its source and destination cards? (Lower priority; skip for initial implementation.)
2. Should there be a keyboard shortcut (e.g. Escape) to clear selection?
3. Should the focused card's **port icons** additionally highlight the specific connected ports (not just the full card)? This would require passing `highlightedTypeIds` down to each port icon.
