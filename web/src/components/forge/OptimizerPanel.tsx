import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import styled, { css } from "styled-components";
import { useOptimizer, type ResolvedNode, type GapAnalysis, type RecipeLookup } from "../../hooks/useOptimizer";
import type { RecipeData } from "../../lib/types";
import { type BlueprintRecipe } from "../../hooks/useBlueprints";
import type { CraftingStyle } from "../../hooks/useCraftingStyle";
import { buildByproductIndex, buildRecipesByOutput, collectRefiningDemands, optimizeOreUsage, type OreSummary } from "../../lib/oreOptimizer";
import { ItemPickerField } from "../shared/ItemPickerField";
import { PrimaryButton, SecondaryButton } from "../shared/Button";
import { useItems } from "../../hooks/useItems";
import { useIdentity } from "../../hooks/useIdentity";
import { useMyStructures } from "../../hooks/useStructures";
import { useAggregatedSsuInventory } from "../../hooks/useAggregatedSsuInventory";
import { SsuInventoryToggle } from "./SsuInventoryToggle";

/* ------------------------------------------------------------------ */
/* Depth-phase colors (progressively muted per depth tier)             */
/* ------------------------------------------------------------------ */

const DEPTH_COLORS = [
  "#00E5FF", // depth 0 — target (electric cyan)
  "#69F0AE", // depth 1 — forge green
  "#7C4DFF", // depth 2 — violet
  "#FFD740", // depth 3 — amber
  "#FF8A65", // depth 4 — coral
  "#80CBC4", // depth 5+ — teal
];

function depthColor(depth: number): string {
  return DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];
}

/* ------------------------------------------------------------------ */
/* Styled components                                                   */
/* ------------------------------------------------------------------ */

const Panel = styled.section`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.lg};
`;

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const Row = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Input = styled.input`
  flex: 1;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  margin: ${({ theme }) => theme.spacing.md} 0;
`;

/* ── Visual Tree ─────────────────────────────────────────────── */

const TreeContainer = styled.div`
  font-size: 13px;
  line-height: 1;
`;

/** Wrapper for each node. Draws connector rails via nested ::before. */
const TreeRow = styled.div<{ $depth: number; $isLast: boolean; $color: string; $satisfied: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 4px ${({ $depth }) => $depth * 24}px;
  min-height: 28px;

  ${({ $satisfied }) =>
    $satisfied &&
    css`
      opacity: 0.55;
    `}

  /* Horizontal connector from rail to node content */
  ${({ $depth, $color }) =>
    $depth > 0 &&
    css`
      &::before {
        content: "";
        position: absolute;
        left: ${($depth - 1) * 24 + 11}px;
        top: 0;
        width: 13px;
        height: 50%;
        border-left: 1px solid ${$color};
        border-bottom: 1px solid ${$color};
        pointer-events: none;
      }
    `}

  /* Vertical rail continuation for non-last siblings */
  ${({ $depth, $isLast, $color }) =>
    $depth > 0 &&
    !$isLast &&
    css`
      &::after {
        content: "";
        position: absolute;
        left: ${($depth - 1) * 24 + 11}px;
        top: 50%;
        width: 0;
        height: 50%;
        border-left: 1px solid ${$color};
        pointer-events: none;
      }
    `}
`;

const NodeIcon = styled.img`
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
`;

const NodeIconPlaceholder = styled.div`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
`;

const NodeName = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const NodeQty = styled.span`
  color: ${({ theme }) => theme.colors.text.secondary};
  white-space: nowrap;
`;

const CraftBadge = styled.span<{ $color: string }>`
  font-size: 10px;
  font-weight: 600;
  color: ${({ $color }) => $color};
  white-space: nowrap;
`;

const RawBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  white-space: nowrap;
`;

const InventoryBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.success};
  white-space: nowrap;
`;

const FacilityPill = styled.span`
  font-size: 9px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  padding: 0 4px;
  white-space: nowrap;
`;

const BlueprintSelect = styled.select`
  font-size: 9px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  padding: 0 2px;
  cursor: pointer;
  max-width: 140px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const CollapseToggle = styled.button`
  background: none;
  border: none;
  padding: 0;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: pointer;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const DepthLabel = styled.span<{ $color: string }>`
  font-size: 9px;
  font-weight: 700;
  color: ${({ $color }) => $color};
  opacity: 0.6;
  white-space: nowrap;
  margin-right: 2px;
`;

const ByproductBadge = styled.span`
  font-size: 9px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.warning};
  white-space: nowrap;
`;

/* ── Gap Analysis ────────────────────────────────────────────── */

const GapRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.xs} 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};
`;

const Missing = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.danger};
`;

const Satisfied = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.success};
`;

const Summary = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const ProgressBarOuter = styled.div`
  height: 4px;
  border-radius: 2px;
  background: ${({ theme }) => theme.colors.surface.bg};
  overflow: hidden;
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const ProgressBarInner = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => Math.min($pct, 100)}%;
  border-radius: 2px;
  background: ${({ $pct, theme }) =>
    $pct >= 100
      ? theme.colors.success
      : $pct > 50
        ? theme.colors.warning
        : theme.colors.danger};
  transition: width 0.3s ease;
`;

/* ── Ore Summary ─────────────────────────────────────────────── */

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
  font-size: 13px;
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

const ModeToggle = styled.button<{ $active: boolean }>`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: ${({ theme }) => theme.radii.sm};
  border: 1px solid ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.surface.border};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main + "22" : "transparent"};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
    color: ${({ theme }) => theme.colors.primary.main};
  }
`;

/* ------------------------------------------------------------------ */
/* Visual tree renderer (recursive component)                          */
/* ------------------------------------------------------------------ */

function VisualTreeNode({
  node,
  depth,
  isLast,
  getItemIcon,
  getItemName,
  collapsed,
  onToggleCollapse,
  allRecipesMap,
  selectedRecipes,
  onSelectRecipe,
}: {
  node: ResolvedNode;
  depth: number;
  isLast: boolean;
  getItemIcon: (id: number) => string;
  getItemName: (id: number) => string;
  collapsed: Set<string>;
  onToggleCollapse: (key: string) => void;
  allRecipesMap: Map<number, BlueprintRecipe[]>;
  selectedRecipes: Map<number, number>;
  onSelectRecipe: (outputTypeId: number, blueprintId: number) => void;
}) {
  const color = depthColor(depth);
  const parentColor = depth > 0 ? depthColor(depth - 1) : color;
  const icon = getItemIcon(node.typeId);
  const nodeKey = `${node.typeId}-${depth}`;
  const isCollapsed = collapsed.has(nodeKey);
  const hasChildren = node.children.length > 0;

  // Blueprint alternatives for this output
  const alternatives = allRecipesMap.get(node.typeId);
  const hasAlternatives = alternatives && alternatives.length > 1 && node.isCraftable;

  return (
    <>
      <TreeRow
        $depth={depth}
        $isLast={isLast}
        $color={parentColor}
        $satisfied={node.satisfiedFromInventory && !node.isCraftable}
      >
        {/* Depth tier indicator */}
        {depth > 0 && <DepthLabel $color={color}>L{depth}</DepthLabel>}

        {/* Collapse toggle */}
        {hasChildren ? (
          <CollapseToggle onClick={() => onToggleCollapse(nodeKey)}>
            {isCollapsed ? "▸" : "▾"}
          </CollapseToggle>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}

        {/* Item icon */}
        {icon ? (
          <NodeIcon src={`/${icon}`} alt="" loading="lazy" />
        ) : (
          <NodeIconPlaceholder />
        )}

        {/* Name + quantity */}
        <NodeName>{getItemName(node.typeId)}</NodeName>
        <NodeQty>×{node.quantityNeeded}</NodeQty>

        {/* Status badges */}
        {node.satisfiedFromInventory && !node.isCraftable && (
          <InventoryBadge>✓ IN SSU</InventoryBadge>
        )}
        {node.satisfiedFromInventory && node.isCraftable && (
          <InventoryBadge>partial SSU</InventoryBadge>
        )}
        {node.isCraftable && (
          <CraftBadge $color={color}>
            {node.runs}× {node.quantityPerRun}/run
          </CraftBadge>
        )}
        {!node.isCraftable && !node.satisfiedFromInventory && (
          <RawBadge>RAW</RawBadge>
        )}

        {/* Byproduct badges */}
        {node.byproducts && node.byproducts.length > 0 && node.byproducts.map((bp) => (
          <ByproductBadge key={bp.typeId}>+{bp.quantity} {getItemName(bp.typeId)}</ByproductBadge>
        ))}

        {/* Facility pill */}
        {node.facilityName && <FacilityPill>{node.facilityName}</FacilityPill>}

        {/* Blueprint selector (when alternatives exist) */}
        {hasAlternatives && (
          <BlueprintSelect
            value={selectedRecipes.get(node.typeId) ?? alternatives![0].blueprintId}
            onChange={(e) => onSelectRecipe(node.typeId, Number(e.target.value))}
            onClick={(e) => e.stopPropagation()}
          >
            {alternatives!.map((r) => (
              <option key={r.blueprintId} value={r.blueprintId}>
                BP#{r.blueprintId} — {r.facilityName}
              </option>
            ))}
          </BlueprintSelect>
        )}
      </TreeRow>

      {/* Children (if not collapsed) */}
      {hasChildren &&
        !isCollapsed &&
        node.children.map((child, i) => (
          <VisualTreeNode
            key={`${child.typeId}-${depth + 1}-${i}`}
            node={child}
            depth={depth + 1}
            isLast={i === node.children.length - 1}
            getItemIcon={getItemIcon}
            getItemName={getItemName}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            allRecipesMap={allRecipesMap}
            selectedRecipes={selectedRecipes}
            onSelectRecipe={onSelectRecipe}
          />
        ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Gap analysis renderer                                               */
/* ------------------------------------------------------------------ */

function renderGaps(
  gaps: GapAnalysis,
  getItemName: (id: number) => string,
  inventoryActive: boolean,
) {
  return (
    <>
      {gaps.shoppingList.map((item) => {
        const pct = item.required > 0 ? (item.onHand / item.required) * 100 : 0;
        return (
          <GapRow key={item.typeId}>
            <div>
              <span>{getItemName(item.typeId)}</span>
              {inventoryActive && (
                <ProgressBarOuter>
                  <ProgressBarInner $pct={pct} />
                </ProgressBarOuter>
              )}
            </div>
            <span>
              {item.onHand}/{item.required} — <Missing>{item.missing} missing</Missing>
            </span>
          </GapRow>
        );
      })}
      {inventoryActive && gaps.satisfied.length > 0 && (
        gaps.satisfied.map((item) => (
          <GapRow key={item.typeId}>
            <span>{getItemName(item.typeId)}</span>
            <Satisfied>✓ {item.required} in SSUs</Satisfied>
          </GapRow>
        ))
      )}
      <Summary>
        {gaps.totalOnHand}/{gaps.totalRequired} on hand · {gaps.totalMissing} missing
        {inventoryActive && gaps.satisfied.length > 0 && (
          <> · <Satisfied>{gaps.satisfied.length} fully covered</Satisfied></>
        )}
      </Summary>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function OptimizerPanel({
  recipes,
  initialTarget,
  allRecipesMap,
  craftingStyle,
  onCraftingStyleChange,
}: {
  recipes: RecipeData[];
  initialTarget?: number | null;
  allRecipesMap: Map<number, BlueprintRecipe[]>;
  craftingStyle: CraftingStyle;
  onCraftingStyleChange: (style: CraftingStyle) => void;
}) {
  const { result, optimize, clear } = useOptimizer(recipes);
  const { getItem } = useItems();
  const { address } = useIdentity();
  const [targetType, setTargetType] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [showOreSummary, setShowOreSummary] = useState(false);

  // Blueprint selection per output typeId
  const [selectedRecipes, setSelectedRecipes] = useState<Map<number, number>>(new Map());

  // Tree collapse state
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // SSU inventory state
  const [ssuInventoryEnabled, setSsuInventoryEnabled] = useState(false);
  const [selectedSsuIds, setSelectedSsuIds] = useState<Set<string>>(new Set());

  const { structures, isLoading: structuresLoading } = useMyStructures();
  const ssus = useMemo(
    () => structures.filter((s) => s.moveType === "StorageUnit"),
    [structures],
  );

  // Auto-enable SSU inventory when wallet is connected and SSUs are loaded
  const autoEnabledRef = useRef(false);
  useEffect(() => {
    if (
      !autoEnabledRef.current &&
      !structuresLoading &&
      !!address &&
      ssus.length > 0
    ) {
      autoEnabledRef.current = true;
      setSsuInventoryEnabled(true);
      setSelectedSsuIds(new Set(ssus.map((s) => s.id)));
    }
  }, [address, ssus, structuresLoading]);

  // Auto-select all SSUs when first enabling the toggle
  const handleToggle = useCallback(
    (on: boolean) => {
      setSsuInventoryEnabled(on);
      if (on && selectedSsuIds.size === 0 && ssus.length > 0) {
        setSelectedSsuIds(new Set(ssus.map((s) => s.id)));
      }
    },
    [ssus, selectedSsuIds.size],
  );

  const selectedSsus = useMemo(
    () => ssus.filter((s) => selectedSsuIds.has(s.id)),
    [ssus, selectedSsuIds],
  );

  const {
    inventory: aggregatedInventory,
    isLoading: inventoryLoading,
    uniqueTypeCount,
    ssuCount,
  } = useAggregatedSsuInventory(selectedSsus, ssuInventoryEnabled);

  const emptyInventory = useMemo(() => new Map<number, number>(), []);
  const effectiveInventory = ssuInventoryEnabled ? aggregatedInventory : emptyInventory;

  // Build recipe lookup that respects user's blueprint selections.
  const recipeLookup = useCallback<RecipeLookup>(
    (typeId: number) => {
      const alternatives = allRecipesMap.get(typeId);
      if (!alternatives || alternatives.length === 0) return undefined;
      const selectedBp = selectedRecipes.get(typeId);
      if (selectedBp != null) {
        return alternatives.find((r) => r.blueprintId === selectedBp) ?? alternatives[0];
      }
      return alternatives[0];
    },
    [allRecipesMap, selectedRecipes],
  );

  // Run optimization with current settings
  const runOptimize = useCallback(
    (typeId: number, qty: number) => {
      optimize(typeId, qty, effectiveInventory, recipeLookup);
      setCollapsed(new Set());
    },
    [optimize, effectiveInventory, recipeLookup],
  );

  // Auto-fill and resolve when a blueprint's "Resolve in Optimizer" is clicked
  useEffect(() => {
    if (initialTarget != null && recipes.length > 0) {
      setTargetType(String(initialTarget));
      setQuantity("1");
      runOptimize(initialTarget, 1);
    }
  }, [initialTarget, recipes.length, runOptimize]);

  // Re-run optimization when inventory or recipe selection changes
  useEffect(() => {
    if (result && targetType) {
      optimize(Number(targetType), Number(quantity), effectiveInventory, recipeLookup);
    }
    // Only re-run when inventory/recipe selection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveInventory, recipeLookup]);

  // Ore optimization (computed on demand when ore summary is visible)
  const byproductIdx = useMemo(() => buildByproductIndex(recipes), [recipes]);
  const recipesByOutput = useMemo(() => buildRecipesByOutput(recipes), [recipes]);
  const oreSummary: OreSummary | null = useMemo(() => {
    if (!showOreSummary || !result) return null;
    const { demands, nonRefiningLeaves } = collectRefiningDemands(result.tree, byproductIdx);
    return optimizeOreUsage(demands, nonRefiningLeaves, byproductIdx, effectiveInventory, recipesByOutput);
  }, [showOreSummary, result, byproductIdx, effectiveInventory, recipesByOutput]);

  function getItemName(typeId: number): string {
    return getItem(typeId)?.name ?? `Type ${typeId}`;
  }

  function getItemIcon(typeId: number): string {
    return getItem(typeId)?.icon ?? "";
  }

  function handleOptimize() {
    const typeId = Number(targetType);
    if (!typeId) return;
    runOptimize(typeId, Number(quantity));
  }

  function handleSelectRecipe(outputTypeId: number, blueprintId: number) {
    setSelectedRecipes((prev) => {
      const next = new Map(prev);
      next.set(outputTypeId, blueprintId);
      return next;
    });
    // Re-run after selection change (handled by effect on recipeLookup)
  }

  function handleToggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Panel>
      <SectionTitle>Optimizer</SectionTitle>

      <Row>
        <ItemPickerField value={targetType} onChange={setTargetType} />
        <Input
          type="number"
          placeholder="Qty"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          style={{ flex: "0 0 80px" }}
        />
        <PrimaryButton onClick={handleOptimize} disabled={!targetType}>
          Resolve
        </PrimaryButton>
        {result && (
          <SecondaryButton onClick={clear}>
            Clear
          </SecondaryButton>
        )}
      </Row>

      {/* Crafting style selector */}
      <Row>
        <span style={{ fontSize: 12, color: "var(--color-text-muted, #888)", marginRight: 4 }}>Crafting Route:</span>
        <ModeToggle
          $active={craftingStyle === "field"}
          onClick={() => {
            onCraftingStyleChange("field");
            setSelectedRecipes(new Map());
          }}
        >
          ⛺ Field
        </ModeToggle>
        <ModeToggle
          $active={craftingStyle === "base"}
          onClick={() => {
            onCraftingStyleChange("base");
            setSelectedRecipes(new Map());
          }}
        >
          🏭 Base
        </ModeToggle>
      </Row>

      <SsuInventoryToggle
        ssus={ssus}
        enabled={ssuInventoryEnabled}
        onToggle={handleToggle}
        selectedIds={selectedSsuIds}
        onSelectionChange={setSelectedSsuIds}
        isLoadingStructures={structuresLoading}
        isLoadingInventory={inventoryLoading}
        uniqueTypeCount={uniqueTypeCount}
        ssuCount={ssuCount}
        walletConnected={!!address}
      />

      {result && (
        <>
          <Divider />
          <SectionTitle>Dependency Tree</SectionTitle>
          <TreeContainer>
            <VisualTreeNode
              node={result.tree}
              depth={0}
              isLast
              getItemIcon={getItemIcon}
              getItemName={getItemName}
              collapsed={collapsed}
              onToggleCollapse={handleToggleCollapse}
              allRecipesMap={allRecipesMap}
              selectedRecipes={selectedRecipes}
              onSelectRecipe={handleSelectRecipe}
            />
          </TreeContainer>

          <Divider />
          <Row>
            <SectionTitle style={{ marginBottom: 0 }}>Gap Analysis</SectionTitle>
            <ModeToggle
              $active={showOreSummary}
              onClick={() => setShowOreSummary((v) => !v)}
            >
              {showOreSummary ? "⛏ Ore Summary" : "⛏ Show Ore Summary"}
            </ModeToggle>
          </Row>
          {result.gaps.shoppingList.length === 0 ? (
            <Summary>
              All materials satisfied!
              {ssuInventoryEnabled && " (from SSU inventory)"}
            </Summary>
          ) : (
            renderGaps(result.gaps, getItemName, ssuInventoryEnabled)
          )}

          {/* ── Ore Summary (when active) ── */}
          {showOreSummary && oreSummary && oreSummary.entries.length > 0 && (
            <>
              <Divider />
              <SectionTitle>Ore Summary — Minimize Mining</SectionTitle>
              <Summary style={{ marginBottom: 8 }}>
                Total ore to mine: <strong>{oreSummary.totalOreUnits.toLocaleString()}</strong> units
                {oreSummary.entries.length > 1 && ` across ${oreSummary.entries.length} ore types`}
              </Summary>
              {oreSummary.entries.map((entry) => {
                const oreIcon = getItemIcon(entry.oreTypeId);
                return (
                  <OreEntryCard key={entry.oreTypeId}>
                    <OreHeader>
                      {oreIcon ? (
                        <OreIcon src={`/${oreIcon}`} alt="" loading="lazy" />
                      ) : null}
                      <OreName>{getItemName(entry.oreTypeId)}</OreName>
                      <OreQty>
                        {entry.totalUnits.toLocaleString()} units · {entry.runs}× runs
                      </OreQty>
                    </OreHeader>
                    {entry.products.map((p) => (
                      <ProductRow key={p.typeId}>
                        <span>{getItemName(p.typeId)}</span>
                        <span>
                          {p.needed > 0 ? `need ${p.needed}` : "not needed"}
                          {" → produces "}
                          {p.produced}
                        </span>
                        {p.surplus > 0 && (
                          <SurplusBadge>+{p.surplus} surplus</SurplusBadge>
                        )}
                      </ProductRow>
                    ))}
                  </OreEntryCard>
                );
              })}
              {oreSummary.unoptimized.length > 0 && (
                <Summary>
                  + {oreSummary.unoptimized.length} other material{oreSummary.unoptimized.length > 1 ? "s" : ""} (single-output recipes)
                </Summary>
              )}
            </>
          )}
        </>
      )}
    </Panel>
  );
}
