import { useState, useCallback, useMemo, useEffect } from "react";
import styled from "styled-components";
import { useOptimizer, type RecipeLookup } from "../../hooks/useOptimizer";
import { useItems } from "../../hooks/useItems";
import { useIdentity } from "../../hooks/useIdentity";
import { useMyStructures } from "../../hooks/useStructures";
import { useStructureStates } from "../../hooks/useStructureStates";
import { useAggregatedSsuInventory } from "../../hooks/useAggregatedSsuInventory";
import { useForgePlannerStorage } from "../../hooks/useForgePlannerStorage";
import { buildCanvasLayout } from "../../lib/buildCanvasLayout";
import type { BlueprintEntry, BlueprintRecipe } from "../../hooks/useBlueprints";
import type { RecipeData } from "../../lib/types";
import type { CraftingStyle } from "../../hooks/useCraftingStyle";
import {
  buildByproductIndex,
  buildRecipesByOutput,
  collectRefiningDemands,
  optimizeOreUsage,
  type OreSummary,
} from "../../lib/oreOptimizer";
import { NetworkNodeSelector } from "./NetworkNodeSelector";
import { StructureToggleList } from "./StructureToggleList";
import { SsuInventoryToggle } from "./SsuInventoryToggle";
import { BlueprintBrowser } from "./BlueprintBrowser";
import { BuildCanvas, type CanvasTransform } from "./canvas/BuildCanvas";

/* ── Types ────────────────────────────────────────────────── */

type PanelId = "blueprint" | "route" | "structures" | "ore";

/* ── Styled components ────────────────────────────────────── */

const ViewWrapper = styled.div`
  position: relative;
  height: calc(100vh - 200px);
  min-height: 500px;
`;

const CanvasArea = styled.div`
  position: absolute;
  inset: 0;
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 14px;
`;

const EmptyTitle = styled.p`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin: 0;
`;

const EmptySub = styled.p`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin: 0;
`;

/* ── Panel tab strip ──────────────────────────────────────── */

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
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  padding: 10px 6px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main + "22" : theme.colors.surface.raised};
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary.main : theme.colors.surface.border};
  border-right: none;
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  cursor: pointer;
  transition: color 0.12s, background 0.12s, border-color 0.12s;

  &:hover {
    color: ${({ theme }) => theme.colors.primary.main};
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

/* ── Panel drawer ─────────────────────────────────────────── */

const TAB_STRIP_WIDTH = 28;
const DRAWER_WIDTH = 280;
const STRUCTURES_DRAWER_WIDTH = 320;

const PanelDrawer = styled.div<{ $width?: number }>`
  position: absolute;
  left: ${TAB_STRIP_WIDTH}px;
  top: 0;
  bottom: 0;
  width: ${({ $width }) => $width ?? DRAWER_WIDTH}px;
  background: ${({ theme }) => theme.colors.surface.raised};
  border-right: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-top: 2px solid ${({ theme }) => theme.colors.primary.main};
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
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};
  flex-shrink: 0;
`;

const DrawerTitle = styled.span`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const DrawerCloseBtn = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const DrawerBody = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

/* ── Drawer inner controls ────────────────────────────────── */

const FieldLabel = styled.span`
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const SelectButton = styled.button<{ $hasSelection: boolean }>`
  padding: 6px 12px;
  background: ${({ $hasSelection, theme }) =>
    $hasSelection ? theme.colors.primary.subtle : theme.colors.surface.overlay};
  border: 1px solid
    ${({ $hasSelection, theme }) =>
      $hasSelection ? theme.colors.primary.main : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ $hasSelection, theme }) =>
    $hasSelection ? theme.colors.primary.main : theme.colors.text.secondary};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
    color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const QtyInput = styled.input`
  width: 80px;
  padding: 6px 8px;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 13px;
  text-align: right;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const ModeRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const ModeButton = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary.main : theme.colors.surface.border};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main + "22" : "transparent"};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  border-radius: ${({ theme }) => theme.radii.sm};
  cursor: pointer;
  transition: all 0.12s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
    color: ${({ theme }) => theme.colors.primary.main};
  }
`;

/* ── Structures panel extras ─────────────────────────────── */

const SectionDivider = styled.div`
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.colors.text.muted};
  border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  padding-top: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const SsuHint = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

/* ── Ore summary panel ────────────────────────────────────── */

const OreEmptyHint = styled.p`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin: 0;
`;

const OreTotalSummary = styled.p`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`;

const OreEntryCard = styled.div`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const OreHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
`;

const OreIcon = styled.img`
  width: 20px;
  height: 20px;
  object-fit: contain;
  flex-shrink: 0;
`;

const OreName = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const OreQty = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-left: auto;
`;

const ProductRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0 2px 26px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const SurplusBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.warning};
`;

/* ── Reset view button ────────────────────────────────────── */

const ResetButton = styled.button`
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 10;
  padding: 5px 10px;
  font-size: 12px;
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: pointer;

  &:hover {
    border-color: ${({ theme }) => theme.colors.text.muted};
    color: ${({ theme }) => theme.colors.text.secondary};
  }
`;

/* ── Blueprint browser overlay ────────────────────────────── */

const BrowserOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: stretch;
  justify-content: center;
  z-index: 100;
  padding: 32px;
`;

const BrowserPanel = styled.div`
  background: ${({ theme }) => theme.colors.surface.overlay};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-top: 2px solid ${({ theme }) => theme.colors.primary.main};
  width: 100%;
  max-width: 1100px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const BrowserHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};
  flex-shrink: 0;
`;

const BrowserTitle = styled.h2`
  font-size: 16px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: 0;
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 4px;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const BrowserContent = styled.div`
  flex: 1;
  padding: ${({ theme }) => theme.spacing.lg};
  overflow-y: auto;
`;

/* ── Component ────────────────────────────────────────────── */

interface Props {
  blueprints: BlueprintEntry[];
  allRecipesMap: Map<number, BlueprintRecipe[]>;
  recipesForOptimizer: RecipeData[];
  craftingStyle: CraftingStyle;
  onCraftingStyleChange: (style: CraftingStyle) => void;
  /** All owned structures (passed in so the canvas view can read network nodes). */
  structures?: import("../../lib/types").AssemblyData[];
  /** Whether the structures query is still loading. */
  structuresLoading?: boolean;
  /** Pre-select a blueprint output typeId on mount (e.g. from "Open in Planner" on blueprint cards). */
  initialTypeId?: number | null;
}

const DEFAULT_TRANSFORM: CanvasTransform = { tx: 40, ty: 40, scale: 1 };

export function BuildCanvasView({
  blueprints,
  allRecipesMap,
  recipesForOptimizer,
  craftingStyle,
  onCraftingStyleChange,
  structures: structuresProp,
  structuresLoading: structuresLoadingProp,
  initialTypeId,
}: Props) {
  const { address } = useIdentity();
  const { getItem } = useItems();

  // Fall back to fetching structures locally if not provided by parent.
  const { structures: ownStructures, isLoading: ownStructuresLoading } = useMyStructures();
  const structures = structuresProp ?? ownStructures;
  const structuresLoading = structuresLoadingProp ?? ownStructuresLoading;

  // Persistent storage — restores last session state from localStorage.
  const storage = useForgePlannerStorage();

  // Selected blueprint and quantity — restored from last session.
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(storage.initial.selectedTypeId);
  const [quantity, setQuantity] = useState(storage.initial.quantity);

  // Panel state
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);

  function togglePanel(id: PanelId) {
    setOpenPanel((prev) => (prev === id ? null : id));
  }

  // Network node selection — restored from last session.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(storage.initial.selectedNodeId);

  // Structure availability states — overrides restored per node via storage callbacks.
  const { structureStates, facilityTypes, setOverride } = useStructureStates(
    selectedNodeId,
    structures,
    blueprints,
    storage.persistOverrides,
    storage.getOverridesForNode,
  );

  // SSU inventory toggles (node-scoped) — restored per node in the effect below.
  const [ssuInventoryEnabled, setSsuInventoryEnabled] = useState(false);
  const [selectedSsuIds, setSelectedSsuIds] = useState<Set<string>>(new Set());

  // SSUs connected to the selected network node
  const nodeSSUs = useMemo(
    () =>
      structures.filter(
        (s) => s.moveType === "StorageUnit" && s.energySourceId === selectedNodeId,
      ),
    [structures, selectedNodeId],
  );

  // Restore per-node SSU state when the network node changes (also runs on mount).
  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedSsuIds(new Set());
      setSsuInventoryEnabled(false);
      return;
    }
    const stored = storage.getSsuForNode(selectedNodeId);
    setSelectedSsuIds(new Set(stored?.ids ?? []));
    setSsuInventoryEnabled(stored?.enabled ?? false);
    // storage.getSsuForNode reads from a ref — stable identity via useCallback([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  const selectedSsuObjects = useMemo(
    () => nodeSSUs.filter((s) => selectedSsuIds.has(s.id)),
    [nodeSSUs, selectedSsuIds],
  );

  const {
    inventory: ssuInventory,
    isLoading: inventoryLoading,
    uniqueTypeCount,
    ssuCount,
  } = useAggregatedSsuInventory(selectedSsuObjects, ssuInventoryEnabled);

  // Canvas transform state
  const [canvasTransform, setCanvasTransform] = useState<CanvasTransform>(DEFAULT_TRANSFORM);

  // Optimizer — inventory is sourced from SSU toggles in the structures panel
  const emptyInventory = useMemo(() => new Map<number, number>(), []);
  const effectiveInventory = useMemo(
    () => (ssuInventoryEnabled ? ssuInventory : emptyInventory),
    [ssuInventoryEnabled, ssuInventory, emptyInventory],
  );
  const { result, optimize } = useOptimizer(recipesForOptimizer);

  const recipeLookup = useCallback<RecipeLookup>(
    (typeId: number) => allRecipesMap.get(typeId)?.[0],
    [allRecipesMap],
  );

  const runOptimize = useCallback(
    (typeId: number, qty: number) => {
      optimize(typeId, qty, effectiveInventory, recipeLookup);
    },
    [optimize, effectiveInventory, recipeLookup],
  );

  // Re-run optimizer when SSU inventory selection or recipe lookup changes.
  useEffect(() => {
    if (selectedTypeId != null) {
      const qty = Math.max(1, parseInt(quantity, 10) || 1);
      optimize(selectedTypeId, qty, effectiveInventory, recipeLookup);
    }
    // Intentionally omits selectedTypeId/quantity — only fires on inventory/recipe changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveInventory, recipeLookup]);

  function handleResolve(outputTypeId: number) {
    setSelectedTypeId(outputTypeId);
    storage.persistBlueprint(outputTypeId, quantity);
    setShowBrowser(false);
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    optimize(outputTypeId, qty, effectiveInventory, recipeLookup);
  }

  // Load blueprint passed in from the browser tab ("Open in Planner" button).
  useEffect(() => {
    if (initialTypeId != null) {
      handleResolve(initialTypeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTypeId]);

  function handleQuantityChange(value: string) {
    setQuantity(value);
    storage.persistBlueprint(selectedTypeId, value);
    if (selectedTypeId != null) {
      const qty = Math.max(1, parseInt(value, 10) || 1);
      optimize(selectedTypeId, qty, effectiveInventory, recipeLookup);
    }
  }

  function handleNodeChange(nodeId: string | null) {
    setSelectedNodeId(nodeId);
    storage.persistNodeId(nodeId);
  }

  function handleSsuEnabledChange(enabled: boolean) {
    setSsuInventoryEnabled(enabled);
    if (selectedNodeId) storage.persistSsuState(selectedNodeId, enabled, selectedSsuIds);
  }

  function handleSsuIdsChange(ids: Set<string>) {
    setSelectedSsuIds(ids);
    if (selectedNodeId) storage.persistSsuState(selectedNodeId, ssuInventoryEnabled, ids);
  }

  // Build canvas layout from optimizer result
  const getBlueprintEntry = useCallback(
    (blueprintId: number) => blueprints.find((b) => b.blueprintId === blueprintId),
    [blueprints],
  );

  const canvasLayout = useMemo(() => {
    if (!result) return null;
    return buildCanvasLayout(result.tree, getBlueprintEntry);
  }, [result, getBlueprintEntry]);

  // Ore summary (lazy — only computed when the ore panel is open)
  const byproductIdx = useMemo(
    () => buildByproductIndex(recipesForOptimizer),
    [recipesForOptimizer],
  );
  const recipesByOutput = useMemo(
    () => buildRecipesByOutput(recipesForOptimizer),
    [recipesForOptimizer],
  );
  const oreSummary = useMemo<OreSummary | null>(() => {
    if (openPanel !== "ore" || !result) return null;
    const { demands, nonRefiningLeaves } = collectRefiningDemands(result.tree, byproductIdx);
    return optimizeOreUsage(demands, nonRefiningLeaves, byproductIdx, effectiveInventory, recipesByOutput);
  }, [openPanel, result, byproductIdx, effectiveInventory, recipesByOutput]);

  // Display name for selected blueprint
  const selectedItemName = useMemo(() => {
    if (selectedTypeId == null) return null;
    return getItem(selectedTypeId)?.name ?? `Type #${selectedTypeId}`;
  }, [selectedTypeId, getItem]);

  return (
    <ViewWrapper>
      {/* ── Canvas area (fills full wrapper) ── */}
      <CanvasArea>
        {canvasLayout ? (
          <BuildCanvas
            layout={canvasLayout}
            getItem={getItem}
            transform={canvasTransform}
            onTransformChange={setCanvasTransform}
            structureStates={structureStates}
          />
        ) : (
          <EmptyState>
            <EmptyTitle>No blueprint selected</EmptyTitle>
            <EmptySub>
              {selectedTypeId == null
                ? "Open the Blueprint panel on the left to begin."
                : "Resolving build chain\u2026"}
            </EmptySub>
          </EmptyState>
        )}
      </CanvasArea>

      {/* ── Panel tab strip ── */}
      <PanelTabStrip>
        <PanelTab
          $active={openPanel === "blueprint"}
          onClick={() => togglePanel("blueprint")}
          title="Blueprint"
        >
          Blueprint
        </PanelTab>
        <PanelTab
          $active={openPanel === "route"}
          onClick={() => togglePanel("route")}
          title="Refining Method"
        >
          Refining Method
        </PanelTab>
        <PanelTab
          $active={openPanel === "structures"}
          onClick={() => togglePanel("structures")}
          title="Structures"
        >
          Structures
        </PanelTab>
        <PanelTab
          $active={openPanel === "ore"}
          onClick={() => togglePanel("ore")}
          title="Ore Summary"
        >
          Ore Summary
        </PanelTab>
      </PanelTabStrip>

      {/* ── Blueprint panel ── */}
      {openPanel === "blueprint" && (
        <PanelDrawer>
          <DrawerHeader>
            <DrawerTitle>Blueprint</DrawerTitle>
            <DrawerCloseBtn onClick={() => setOpenPanel(null)}>&times;</DrawerCloseBtn>
          </DrawerHeader>
          <DrawerBody>
            <FieldGroup>
              <FieldLabel>Selected</FieldLabel>
              <SelectButton
                $hasSelection={selectedTypeId != null}
                onClick={() => setShowBrowser(true)}
              >
                {selectedItemName ?? "Select blueprint\u2026"}
              </SelectButton>
            </FieldGroup>
            <FieldGroup>
              <FieldLabel>Quantity</FieldLabel>
              <QtyInput
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => handleQuantityChange(e.target.value)}
              />
            </FieldGroup>
          </DrawerBody>
        </PanelDrawer>
      )}

      {/* ── Refining Method panel ── */}
      {openPanel === "route" && (
        <PanelDrawer>
          <DrawerHeader>
            <DrawerTitle>Refining Method</DrawerTitle>
            <DrawerCloseBtn onClick={() => setOpenPanel(null)}>&times;</DrawerCloseBtn>
          </DrawerHeader>
          <DrawerBody>
            <FieldGroup>
              <FieldLabel>Crafting Style</FieldLabel>
              <ModeRow>
                <ModeButton
                  $active={craftingStyle === "field"}
                  onClick={() => onCraftingStyleChange("field")}
                >
                  ⛺ Field
                </ModeButton>
                <ModeButton
                  $active={craftingStyle === "base"}
                  onClick={() => onCraftingStyleChange("base")}
                >
                  🏭 Base
                </ModeButton>
              </ModeRow>
            </FieldGroup>
          </DrawerBody>
        </PanelDrawer>
      )}

      {/* ── Structures panel ── */}
      {openPanel === "structures" && (
        <PanelDrawer $width={STRUCTURES_DRAWER_WIDTH}>
          <DrawerHeader>
            <DrawerTitle>Structures</DrawerTitle>
            <DrawerCloseBtn onClick={() => setOpenPanel(null)}>&times;</DrawerCloseBtn>
          </DrawerHeader>
          <DrawerBody>
            <NetworkNodeSelector
              structures={structures}
              selectedNodeId={selectedNodeId}
              onSelect={handleNodeChange}
              isLoading={structuresLoading}
              walletConnected={!!address}
            />
            <StructureToggleList
              facilityTypes={facilityTypes}
              structureStates={structureStates}
              onStateChange={setOverride}
            />
            <SectionDivider>SSU Inventory</SectionDivider>
            {selectedNodeId == null ? (
              <SsuHint>Select a network node to see connected SSUs.</SsuHint>
            ) : (
              <SsuInventoryToggle
                ssus={nodeSSUs}
                enabled={ssuInventoryEnabled}
                onToggle={handleSsuEnabledChange}
                selectedIds={selectedSsuIds}
                onSelectionChange={handleSsuIdsChange}
                isLoadingStructures={structuresLoading}
                isLoadingInventory={inventoryLoading}
                uniqueTypeCount={uniqueTypeCount}
                ssuCount={ssuCount}
                walletConnected={!!address}
              />
            )}
          </DrawerBody>
        </PanelDrawer>
      )}

      {/* ── Ore summary panel ── */}
      {openPanel === "ore" && (
        <PanelDrawer $width={STRUCTURES_DRAWER_WIDTH}>
          <DrawerHeader>
            <DrawerTitle>Ore Summary</DrawerTitle>
            <DrawerCloseBtn onClick={() => setOpenPanel(null)}>&times;</DrawerCloseBtn>
          </DrawerHeader>
          <DrawerBody>
            {!result ? (
              <OreEmptyHint>Select a blueprint to see ore requirements.</OreEmptyHint>
            ) : !oreSummary || oreSummary.entries.length === 0 ? (
              <OreEmptyHint>No multi-output refining required for this build.</OreEmptyHint>
            ) : (
              <>
                <OreTotalSummary>
                  Total: <strong>{oreSummary.totalOreUnits.toLocaleString()}</strong> ore units
                  {oreSummary.entries.length > 1 && ` across ${oreSummary.entries.length} ore types`}
                </OreTotalSummary>
                {oreSummary.entries.map((entry) => {
                  const oreItem = getItem(entry.oreTypeId);
                  return (
                    <OreEntryCard key={entry.oreTypeId}>
                      <OreHeader>
                        {oreItem?.icon ? (
                          <OreIcon src={`/${oreItem.icon}`} alt="" loading="lazy" />
                        ) : null}
                        <OreName>{oreItem?.name ?? `Type ${entry.oreTypeId}`}</OreName>
                        <OreQty>
                          {entry.totalUnits.toLocaleString()} units · {entry.runs}× runs
                        </OreQty>
                      </OreHeader>
                      {entry.products.map((p) => {
                        const productName = getItem(p.typeId)?.name ?? `Type ${p.typeId}`;
                        return (
                          <ProductRow key={p.typeId}>
                            <span>{productName}</span>
                            <span>
                              {p.needed > 0 ? `need ${p.needed}` : "not needed"}
                              {" → produces "}
                              {p.produced}
                            </span>
                            {p.surplus > 0 && (
                              <SurplusBadge>+{p.surplus} surplus</SurplusBadge>
                            )}
                          </ProductRow>
                        );
                      })}
                    </OreEntryCard>
                  );
                })}
                {oreSummary.unoptimized.length > 0 && (
                  <OreEmptyHint>
                    + {oreSummary.unoptimized.length} other material
                    {oreSummary.unoptimized.length > 1 ? "s" : ""} (single-output recipes)
                  </OreEmptyHint>
                )}
              </>
            )}
          </DrawerBody>
        </PanelDrawer>
      )}

      {/* ── Reset view ── */}
      <ResetButton
        onClick={() => setCanvasTransform(DEFAULT_TRANSFORM)}
        title="Reset pan and zoom"
      >
        ⌖ Reset View
      </ResetButton>

      {/* ── Blueprint browser overlay ── */}
      {showBrowser && (
        <BrowserOverlay
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowBrowser(false);
          }}
        >
          <BrowserPanel>
            <BrowserHeader>
              <BrowserTitle>Select Blueprint</BrowserTitle>
              <CloseBtn onClick={() => setShowBrowser(false)}>&times;</CloseBtn>
            </BrowserHeader>
            <BrowserContent>
              <BlueprintBrowser blueprints={blueprints} onResolve={handleResolve} />
            </BrowserContent>
          </BrowserPanel>
        </BrowserOverlay>
      )}
    </ViewWrapper>
  );
}
