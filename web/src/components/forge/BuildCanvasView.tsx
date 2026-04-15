import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import styled from "styled-components";
import { useOptimizer, type RecipeLookup } from "../../hooks/useOptimizer";
import { useItems } from "../../hooks/useItems";
import { useIdentity } from "../../hooks/useIdentity";
import { useMyStructures } from "../../hooks/useStructures";
import { useAggregatedSsuInventory } from "../../hooks/useAggregatedSsuInventory";
import { buildCanvasLayout } from "../../lib/buildCanvasLayout";
import type { BlueprintEntry, BlueprintRecipe } from "../../hooks/useBlueprints";
import type { RecipeData } from "../../lib/types";
import type { CraftingStyle } from "../../hooks/useCraftingStyle";
import { SsuInventoryToggle } from "./SsuInventoryToggle";
import { BlueprintBrowser } from "./BlueprintBrowser";
import { BuildCanvas, type CanvasTransform } from "./canvas/BuildCanvas";

/* ── Styled components ────────────────────────────────────────── */

const ViewWrapper = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - 200px);
  min-height: 500px;
  gap: 0;
`;

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-bottom: none;
  flex-shrink: 0;
`;

const ToolbarSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const ToolbarLabel = styled.span`
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const ToolbarRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const SelectButton = styled.button<{ $hasSelection: boolean }>`
  padding: 6px 12px;
  background: ${({ $hasSelection, theme }) =>
    $hasSelection ? theme.colors.primary.subtle : theme.colors.surface.overlay};
  border: 1px solid ${({ $hasSelection, theme }) =>
    $hasSelection ? theme.colors.primary.main : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ $hasSelection, theme }) =>
    $hasSelection ? theme.colors.primary.main : theme.colors.text.secondary};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  max-width: 220px;
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
  width: 72px;
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

const ModeButton = styled.button<{ $active: boolean }>`
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid ${({ $active, theme }) =>
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

const ResetButton = styled.button`
  padding: 5px 10px;
  font-size: 12px;
  background: none;
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: pointer;
  margin-left: auto;
  align-self: flex-end;

  &:hover {
    border-color: ${({ theme }) => theme.colors.text.muted};
    color: ${({ theme }) => theme.colors.text.secondary};
  }
`;

const CanvasArea = styled.div`
  flex: 1;
  min-height: 0;
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

/* ── Wide blueprint browser overlay ──────────────────────────── */

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

/* ── Component ────────────────────────────────────────────────── */

interface Props {
  blueprints: BlueprintEntry[];
  allRecipesMap: Map<number, BlueprintRecipe[]>;
  recipesForOptimizer: RecipeData[];
  craftingStyle: CraftingStyle;
  onCraftingStyleChange: (style: CraftingStyle) => void;
}

const DEFAULT_TRANSFORM: CanvasTransform = { tx: 40, ty: 40, scale: 1 };

export function BuildCanvasView({
  blueprints,
  allRecipesMap,
  recipesForOptimizer,
  craftingStyle,
  onCraftingStyleChange,
}: Props) {
  const { address } = useIdentity();
  const { getItem } = useItems();

  // Selected blueprint and quantity
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1");

  // Blueprint browser modal
  const [showBrowser, setShowBrowser] = useState(false);

  // SSU state (mirrors OptimizerPanel pattern)
  const [ssuEnabled, setSsuEnabled] = useState(false);
  const [selectedSsuIds, setSelectedSsuIds] = useState<Set<string>>(new Set());
  const { structures, isLoading: structuresLoading } = useMyStructures();
  const ssus = useMemo(() => structures.filter((s) => s.moveType === "StorageUnit"), [structures]);

  const autoEnabledRef = useRef(false);
  useEffect(() => {
    if (!autoEnabledRef.current && !structuresLoading && !!address && ssus.length > 0) {
      autoEnabledRef.current = true;
      setSsuEnabled(true);
      setSelectedSsuIds(new Set(ssus.map((s) => s.id)));
    }
  }, [address, ssus, structuresLoading]);

  const handleSsuToggle = useCallback(
    (on: boolean) => {
      setSsuEnabled(on);
      if (on && selectedSsuIds.size === 0 && ssus.length > 0) {
        setSelectedSsuIds(new Set(ssus.map((s) => s.id)));
      }
    },
    [ssus, selectedSsuIds.size],
  );

  const selectedSsus = useMemo(() => ssus.filter((s) => selectedSsuIds.has(s.id)), [ssus, selectedSsuIds]);
  const {
    inventory: aggregatedInventory,
    isLoading: inventoryLoading,
    uniqueTypeCount,
    ssuCount,
  } = useAggregatedSsuInventory(selectedSsus, ssuEnabled);

  const emptyInventory = useMemo(() => new Map<number, number>(), []);
  const effectiveInventory = ssuEnabled ? aggregatedInventory : emptyInventory;

  // Canvas transform state
  const [canvasTransform, setCanvasTransform] = useState<CanvasTransform>(DEFAULT_TRANSFORM);

  // Optimizer
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

  // Re-run when inventory or recipe map changes (craftingStyle, SSU selection)
  useEffect(() => {
    if (selectedTypeId != null) {
      runOptimize(selectedTypeId, Math.max(1, parseInt(quantity, 10) || 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveInventory, recipeLookup]);

  function handleResolve(outputTypeId: number) {
    setSelectedTypeId(outputTypeId);
    setShowBrowser(false);
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    optimize(outputTypeId, qty, effectiveInventory, recipeLookup);
  }

  function handleQuantityChange(value: string) {
    setQuantity(value);
    if (selectedTypeId != null) {
      const qty = Math.max(1, parseInt(value, 10) || 1);
      optimize(selectedTypeId, qty, effectiveInventory, recipeLookup);
    }
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

  // Display name for selected blueprint
  const selectedItemName = useMemo(() => {
    if (selectedTypeId == null) return null;
    return getItem(selectedTypeId)?.name ?? `Type #${selectedTypeId}`;
  }, [selectedTypeId, getItem]);

  return (
    <ViewWrapper>
      {/* ── Toolbar ── */}
      <Toolbar>
        {/* Blueprint picker */}
        <ToolbarSection>
          <ToolbarLabel>Blueprint</ToolbarLabel>
          <SelectButton
            $hasSelection={selectedTypeId != null}
            onClick={() => setShowBrowser(true)}
          >
            {selectedItemName ?? "Select blueprint…"}
          </SelectButton>
        </ToolbarSection>

        {/* Quantity */}
        <ToolbarSection>
          <ToolbarLabel>Quantity</ToolbarLabel>
          <QtyInput
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => handleQuantityChange(e.target.value)}
          />
        </ToolbarSection>

        {/* Crafting style */}
        <ToolbarSection>
          <ToolbarLabel>Route</ToolbarLabel>
          <ToolbarRow>
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
          </ToolbarRow>
        </ToolbarSection>

        {/* SSU inventory toggle */}
        <ToolbarSection style={{ flex: 1, minWidth: 220 }}>
          <ToolbarLabel>SSU Inventory</ToolbarLabel>
          <SsuInventoryToggle
            ssus={ssus}
            enabled={ssuEnabled}
            onToggle={handleSsuToggle}
            selectedIds={selectedSsuIds}
            onSelectionChange={setSelectedSsuIds}
            isLoadingStructures={structuresLoading}
            isLoadingInventory={inventoryLoading}
            uniqueTypeCount={uniqueTypeCount}
            ssuCount={ssuCount}
            walletConnected={!!address}
          />
        </ToolbarSection>

        {/* Reset view */}
        <ResetButton
          onClick={() => setCanvasTransform(DEFAULT_TRANSFORM)}
          title="Reset pan and zoom"
        >
          ⌖ Reset View
        </ResetButton>
      </Toolbar>

      {/* ── Canvas area ── */}
      <CanvasArea>
        {canvasLayout ? (
          <BuildCanvas
            layout={canvasLayout}
            getItem={getItem}
            transform={canvasTransform}
            onTransformChange={setCanvasTransform}
          />
        ) : (
          <EmptyState>
            <EmptyTitle>No blueprint selected</EmptyTitle>
            <EmptySub>
              {selectedTypeId == null
                ? 'Click "Select blueprint\u2026" above to begin.'
                : "Resolving build chain…"}
            </EmptySub>
          </EmptyState>
        )}
      </CanvasArea>

      {/* ── Blueprint browser overlay ── */}
      {showBrowser && (
        <BrowserOverlay onMouseDown={(e) => { if (e.target === e.currentTarget) setShowBrowser(false); }}>
          <BrowserPanel>
            <BrowserHeader>
              <BrowserTitle>Select Blueprint</BrowserTitle>
              <CloseBtn onClick={() => setShowBrowser(false)}>&times;</CloseBtn>
            </BrowserHeader>
            <BrowserContent>
              <BlueprintBrowser
                blueprints={blueprints}
                onResolve={handleResolve}
              />
            </BrowserContent>
          </BrowserPanel>
        </BrowserOverlay>
      )}
    </ViewWrapper>
  );
}
