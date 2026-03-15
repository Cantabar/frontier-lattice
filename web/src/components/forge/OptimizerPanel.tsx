import { useState, useEffect } from "react";
import styled from "styled-components";
import { useOptimizer, type ResolvedNode, type GapAnalysis } from "../../hooks/useOptimizer";
import type { RecipeData } from "../../lib/types";
import { ItemPickerField } from "../shared/ItemPickerField";
import { PrimaryButton, SecondaryButton } from "../shared/Button";
import { useItems } from "../../hooks/useItems";

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

const TreeNode = styled.div<{ $depth: number }>`
  padding-left: ${({ $depth }) => $depth * 16}px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.6;
`;

const CraftBadge = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.module.forgePlanner};
`;

const RawBadge = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
`;

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

const Summary = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

function renderTree(node: ResolvedNode, getItemName: (id: number) => string, depth = 0): JSX.Element[] {
  const badge = node.isCraftable ? (
    <CraftBadge> ({node.runs}× {node.quantityPerRun}/run)</CraftBadge>
  ) : (
    <RawBadge> [RAW]</RawBadge>
  );

  const elements = [
    <TreeNode key={`${node.typeId}-${depth}`} $depth={depth}>
      {getItemName(node.typeId)} ×{node.quantityNeeded}{badge}
    </TreeNode>,
  ];

  for (const child of node.children) {
    elements.push(...renderTree(child, getItemName, depth + 1));
  }

  return elements;
}

function renderGaps(gaps: GapAnalysis, getItemName: (id: number) => string) {
  return (
    <>
      {gaps.shoppingList.map((item) => (
        <GapRow key={item.typeId}>
          <span>{getItemName(item.typeId)}</span>
          <span>
            {item.onHand}/{item.required} — <Missing>{item.missing} missing</Missing>
          </span>
        </GapRow>
      ))}
      <Summary>
        {gaps.totalOnHand}/{gaps.totalRequired} on hand · {gaps.totalMissing} missing
      </Summary>
    </>
  );
}

export function OptimizerPanel({
  recipes,
  initialTarget,
}: {
  recipes: RecipeData[];
  initialTarget?: number | null;
}) {
  const { result, optimize, clear } = useOptimizer(recipes);
  const { getItem } = useItems();
  const [targetType, setTargetType] = useState("");
  const [quantity, setQuantity] = useState("1");

  // Auto-fill and resolve when a blueprint's "Resolve in Optimizer" is clicked
  useEffect(() => {
    if (initialTarget != null && recipes.length > 0) {
      setTargetType(String(initialTarget));
      setQuantity("1");
      optimize(initialTarget, 1);
    }
  }, [initialTarget, recipes.length, optimize]);

  function getItemName(typeId: number): string {
    return getItem(typeId)?.name ?? `Type ${typeId}`;
  }

  function handleOptimize() {
    const typeId = Number(targetType);
    if (!typeId) return;
    optimize(typeId, Number(quantity));
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

      {result && (
        <>
          <Divider />
          <SectionTitle>Dependency Tree</SectionTitle>
          {renderTree(result.tree, getItemName)}

          <Divider />
          <SectionTitle>Gap Analysis</SectionTitle>
          {result.gaps.shoppingList.length === 0 ? (
            <Summary>All materials satisfied!</Summary>
          ) : (
            renderGaps(result.gaps, getItemName)
          )}
        </>
      )}
    </Panel>
  );
}
