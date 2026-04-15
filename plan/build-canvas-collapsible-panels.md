# [frontier-corm][web] Build Canvas — Collapsible Side Panels

## Goal

Replace the flat Toolbar strip in `BuildCanvasView` with three collapsible floating panels — **Blueprint**, **Route**, and **SSU Inventory** — that dock to the left edge of the canvas. When collapsed, each panel shrinks to a narrow icon-only strip. When expanded, each panel opens as a side-drawer over the canvas. This frees up the full viewport for the canvas by default.

---

## Current State

`BuildCanvasView.tsx` renders a `<Toolbar>` bar above the canvas that contains:

1. **Blueprint** section — `SelectButton` that opens a full-screen `BrowserOverlay` modal
2. **Quantity** — a `<QtyInput>` number field (lives alongside Blueprint)
3. **Route** — two `ModeButton` toggles (Field / Base)
4. **SSU Inventory** — `SsuInventoryToggle` component (complex, has its own modal picker)
5. **Reset View** button — small utility button

The toolbar takes a fixed vertical strip of the canvas height and expands with content.

---

## Design

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [canvas area fills entire space]                           │
│                                                             │
│ ┌──┐                                                        │
│ │ B│  ← collapsed panel tab (Blueprint)                     │
│ ├──┤                                                        │
│ │ R│  ← collapsed panel tab (Route)                         │
│ ├──┤                                                        │
│ │ S│  ← collapsed panel tab (SSU)                           │
│ └──┘                                                        │
│                                              [⌖ Reset View] │
└─────────────────────────────────────────────────────────────┘
```

When a panel tab is clicked, a drawer slides out from the left **over** the canvas (not pushing it):

```
┌──────────────┬──────────────────────────────────────────────┐
│ Blueprint  ✕ │  [canvas, behind drawer]                     │
│──────────────│                                              │
│ [Quantity  ] │                                              │
│              │                                              │
│ [browse btn] │                                              │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

Only one panel can be open at a time. Clicking the same tab again, or the ✕ close button, collapses it. Clicking outside the drawer also closes it.

---

## Implementation Plan

### Step 1 — Wrap canvas area and panels in a relative container

Change `ViewWrapper` to fill available height with `position: relative`. Remove `Toolbar` entirely. The canvas area gets `position: absolute; inset: 0` (fills the full container). Panels float via `position: absolute` on top of it.

### Step 2 — Build `<CollapsiblePanel>` component (in `BuildCanvasView.tsx` or a new file)

A generic panel component with props:
```ts
interface CollapsiblePanelProps {
  id: string;
  label: string;        // e.g. "Blueprint"
  icon: string;         // e.g. "B" or a short sigil
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;       // default 280
}
```

The panel renders:
- A vertical **tab** strip on the left (always visible, z-index 10)
- When `isOpen`, a **drawer** panel that slides in from the left (z-index 20), overlaying the canvas
- The tab strip contains stacked tabs for all panels; each `CollapsiblePanel` contributes its own tab via a shared tab strip

**Recommended approach:** manage a single `openPanel: "blueprint" | "route" | "ssu" | null` state in `BuildCanvasView`. Render three panel drawer `<div>`s conditionally, and a single vertical tab strip on the left edge.

### Step 3 — Panel: Blueprint

Content (same as current Toolbar Blueprint + Quantity sections):
- Label: "Blueprint"
- Quantity field (always visible inside panel)
- "Browse…" button that opens the existing `BrowserOverlay` modal

### Step 4 — Panel: Route

Content (same as current Toolbar Route section):
- Label: "Route"
- Field / Base `ModeButton` toggles

### Step 5 — Panel: SSU Inventory

Content (same as current Toolbar SSU Inventory section):
- Label: "SSU Inventory"
- Full `SsuInventoryToggle` component

### Step 6 — Reset View button

Float the existing `ResetButton` in the bottom-right corner of `CanvasArea` (`position: absolute; bottom: 12px; right: 12px`).

### Step 7 — Remove Toolbar

Delete the `Toolbar`, `ToolbarSection`, `ToolbarLabel`, `ToolbarRow` styled components (and any related styled components that are no longer used).

---

## Styled Component Additions (in `BuildCanvasView.tsx`)

```ts
// Outer wrapper — relative so panels can anchor to it
const ViewWrapper = styled.div`
  position: relative;
  height: calc(100vh - 200px);
  min-height: 500px;
`;

// Canvas fills the whole wrapper
const CanvasArea = styled.div`
  position: absolute;
  inset: 0;
  border: 1px solid ...;
`;

// Vertical tab strip anchored to the left
const PanelTabStrip = styled.div`
  position: absolute;
  left: 0;
  top: 24px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const PanelTab = styled.button<{ $active: boolean }>`
  writing-mode: vertical-rl;  /* rotated text */
  text-orientation: mixed;
  transform: rotate(180deg);
  padding: 10px 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: ${({ $active, theme }) => $active ? theme.colors.primary.main + '22' : theme.colors.surface.raised};
  border: 1px solid ${({ $active, theme }) => $active ? theme.colors.primary.main : theme.colors.surface.border};
  border-right: none;  /* flush with drawer */
  color: ${({ $active, theme }) => $active ? theme.colors.primary.main : theme.colors.text.muted};
  cursor: pointer;
`;

// Drawer that slides over the canvas from the left
const PanelDrawer = styled.div<{ $width: number }>`
  position: absolute;
  left: 28px;  /* width of tab strip */
  top: 0;
  bottom: 0;
  width: ${({ $width }) => $width}px;
  background: ${({ theme }) => theme.colors.surface.raised};
  border-right: 1px solid ${({ theme }) => theme.colors.surface.border};
  z-index: 20;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const DrawerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid ...;
  flex-shrink: 0;
`;

const DrawerBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px;
`;
```

---

## State Changes in `BuildCanvasView`

```ts
type PanelId = "blueprint" | "route" | "ssu";

// Replace showBrowser with:
const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
// Blueprint browser modal remains separate (triggered from within Blueprint panel)
const [showBrowser, setShowBrowser] = useState(false);

function togglePanel(id: PanelId) {
  setOpenPanel(prev => prev === id ? null : id);
}
```

---

## Files to Change

| File | Change |
|---|---|
| `web/src/components/forge/BuildCanvasView.tsx` | Primary change — implement panels, remove Toolbar |

No other files need to change. `BlueprintBrowser`, `SsuInventoryToggle`, and `BrowserOverlay` are reused as-is.

---

## Non-Goals

- No animation/transition on the drawer (keep it simple, can add later)
- No drag-to-resize on panels
- No persistence of open/closed state across sessions
