import { useState } from "react";
import styled from "styled-components";
import { useBlueprints } from "../hooks/useBlueprints";
import { useCraftingStyle } from "../hooks/useCraftingStyle";
import { BlueprintBrowser } from "../components/forge/BlueprintBrowser";
import { BuildCanvasView } from "../components/forge/BuildCanvasView";

// ── Page-level tab type ────────────────────────────────────────

type PageTab = "blueprints" | "planner";

// ── Styled components ──────────────────────────────────────────

const Page = styled.div``;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const PageTabBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 2px solid ${({ theme }) => theme.colors.surface.border};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const PageTabButton = styled.button<{ $active: boolean }>`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  font-size: 14px;
  font-weight: 600;
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  background: none;
  border: none;
  border-bottom: 2px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary.main : "transparent"};
  margin-bottom: -2px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;


// ── Page component ─────────────────────────────────────────────

export function ForgePlanner() {
  const { craftingStyle, setCraftingStyle } = useCraftingStyle();
  const { blueprints, recipesForOptimizer, allRecipesMap } = useBlueprints(craftingStyle);

  const [activeTab, setActiveTab] = useState<PageTab>("blueprints");
  const [plannerTypeId, setPlannerTypeId] = useState<number | null>(null);

  function openInPlanner(outputTypeId: number) {
    setPlannerTypeId(outputTypeId);
    setActiveTab("planner");
  }

  return (
    <Page>
      <Header>
        <Title>Forge Planner</Title>
      </Header>

      {/* ── Tab bar ── */}
      <PageTabBar>
        <PageTabButton $active={activeTab === "blueprints"} onClick={() => setActiveTab("blueprints")}>
          Blueprints
        </PageTabButton>
        <PageTabButton $active={activeTab === "planner"} onClick={() => setActiveTab("planner")}>
          Planner
        </PageTabButton>
      </PageTabBar>

      {/* ── Tab: Blueprints ── */}
      {activeTab === "blueprints" && (
        <BlueprintBrowser blueprints={blueprints} onResolve={openInPlanner} />
      )}

      {/* ── Tab: Planner ── */}
      {activeTab === "planner" && (
        <BuildCanvasView
          blueprints={blueprints}
          allRecipesMap={allRecipesMap}
          recipesForOptimizer={recipesForOptimizer}
          craftingStyle={craftingStyle}
          onCraftingStyleChange={setCraftingStyle}
          initialTypeId={plannerTypeId}
        />
      )}
    </Page>
  );
}
