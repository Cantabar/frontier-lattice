import { useState, useMemo } from "react";
import styled from "styled-components";
import type { BlueprintEntry } from "../../hooks/useBlueprints";
import { useItems } from "../../hooks/useItems";
import { BlueprintDetailModal } from "./BlueprintDetailModal";

// ── Tier color map (matches theme.colors.tier) ─────────────────

const TIER_COLOR: Record<string, string> = {
  Basic: "#666666",
  Standard: "#b0b0b0",
  Enhanced: "#4caf50",
  Prototype: "#42a5f5",
  Experimental: "#ab47bc",
  Exotic: "#ffd740",
};

// ── Styled components ──────────────────────────────────────────

type GroupBy = "category" | "facility";

const Section = styled.section`
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SectionHeader = styled.button`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  cursor: pointer;
  user-select: none;
`;

const SectionTitle = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: 0;
`;

const Chevron = styled.span<{ $open: boolean }>`
  display: inline-block;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.muted};
  transition: transform 0.15s;
  transform: rotate(${({ $open }) => ($open ? "90deg" : "0deg")});
`;

const GroupByRow = styled.div`
  display: flex;
  gap: 2px;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const GroupByOption = styled.button<{ $active: boolean }>`
  padding: 3px 8px;
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.text.muted : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.surface.overlay : "transparent"};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.text.primary : theme.colors.text.muted};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    border-color: ${({ theme }) => theme.colors.text.muted};
  }
`;

const TabBar = styled.div`
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const Tab = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary.main : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.subtle : "transparent"};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.secondary};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const FiltersRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const GroupSelect = styled.select`
  padding: 4px 8px;
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.bg};
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 12px;
  cursor: pointer;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const Search = styled.input`
  flex: 1;
  min-width: 180px;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 13px;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const CountBadge = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  white-space: nowrap;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: ${({ theme }) => theme.spacing.sm};
  max-height: 480px;
  overflow-y: auto;
`;

const Card = styled.button<{ $tierColor?: string }>`
  display: flex;
  align-items: flex-start;
  gap: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-left: 3px solid
    ${({ $tierColor, theme }) => $tierColor ?? theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s;

  &:hover {
    border-right-color: ${({ theme }) => theme.colors.primary.main};
    border-top-color: ${({ theme }) => theme.colors.primary.main};
    border-bottom-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const CardIcon = styled.img`
  width: 48px;
  height: 48px;
  object-fit: contain;
  flex-shrink: 0;
`;

const CardBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const CardName = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CardGroup = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: 1px;
`;

const FacilityBadge = styled.span`
  font-size: 9px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: 3px;
  padding: 0 3px;
  white-space: nowrap;
`;

const InputsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
  flex-wrap: wrap;
`;

const InputChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const InputIcon = styled.img`
  width: 16px;
  height: 16px;
  object-fit: contain;
`;

const BadgeRow = styled.div`
  display: flex;
  gap: 4px;
  margin-top: 4px;
`;

const TimeBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: 3px;
  padding: 0 4px;
`;

const MultiOutputBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.module.forgePlanner};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.module.forgePlanner};
  border-radius: 3px;
  padding: 0 4px;
`;

const Empty = styled.p`
  text-align: center;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 13px;
  grid-column: 1 / -1;
  padding: ${({ theme }) => theme.spacing.lg} 0;
`;

// ── Component ──────────────────────────────────────────────────

interface Props {
  blueprints: BlueprintEntry[];
  onResolve?: (outputTypeId: number) => void;
}

export function BlueprintBrowser({ blueprints, onResolve }: Props) {
  const { getItem } = useItems();

  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [activeFacility, setActiveFacility] = useState<string | null>(null);
  const [selectedBp, setSelectedBp] = useState<BlueprintEntry | null>(null);

  // Unique categories from blueprints
  const categories = useMemo(
    () =>
      [
        ...new Set(
          blueprints.map((b) => b.primaryCategoryName).filter(Boolean),
        ),
      ] as string[],
    [blueprints],
  );

  // Unique facility names across all blueprints
  const facilityNames = useMemo(
    () =>
      [
        ...new Set(
          blueprints.flatMap((b) => b.facilities.map((f) => f.facilityName)),
        ),
      ].sort(),
    [blueprints],
  );

  // Tab labels depend on groupBy mode
  const tabs = groupBy === "category" ? categories : facilityNames;

  // Groups within the active tab (sub-filter dropdown)
  const groups = useMemo(() => {
    if (!activeTab) return [];
    let subset = blueprints;
    if (groupBy === "category") {
      subset = subset.filter((b) => b.primaryCategoryName === activeTab);
      return [
        ...new Set(subset.map((b) => b.primaryGroupName).filter(Boolean)),
      ] as string[];
    } else {
      // Facility mode — show output categories within the selected facility
      subset = subset.filter((b) =>
        b.facilities.some((f) => f.facilityName === activeTab),
      );
      return [
        ...new Set(subset.map((b) => b.primaryCategoryName).filter(Boolean)),
      ] as string[];
    }
  }, [blueprints, activeTab, groupBy]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = blueprints;

    // Tab filter
    if (activeTab) {
      if (groupBy === "category") {
        list = list.filter((b) => b.primaryCategoryName === activeTab);
        if (activeGroup) {
          list = list.filter((b) => b.primaryGroupName === activeGroup);
        }
      } else {
        list = list.filter((b) =>
          b.facilities.some((f) => f.facilityName === activeTab),
        );
        if (activeGroup) {
          list = list.filter((b) => b.primaryCategoryName === activeGroup);
        }
      }
    }

    // Facility dropdown filter (independent, available in category mode)
    if (activeFacility) {
      list = list.filter((b) =>
        b.facilities.some((f) => f.facilityName === activeFacility),
      );
    }

    // Text search
    const q = query.toLowerCase().trim();
    if (q) {
      list = list.filter(
        (b) =>
          b.primaryName.toLowerCase().includes(q) ||
          String(b.blueprintId).includes(q),
      );
    }

    return list;
  }, [blueprints, activeTab, activeGroup, activeFacility, groupBy, query]);

  function itemIconPath(typeId: number): string {
    return getItem(typeId)?.icon ?? "";
  }

  function handleGroupByChange(mode: GroupBy) {
    setGroupBy(mode);
    setActiveTab(null);
    setActiveGroup(null);
    if (mode === "facility") setActiveFacility(null);
  }

  return (
    <Section>
      <SectionHeader onClick={() => setCollapsed((c) => !c)}>
        <Chevron $open={!collapsed}>▸</Chevron>
        <SectionTitle>Blueprints</SectionTitle>
        <CountBadge>{filtered.length} blueprints</CountBadge>
      </SectionHeader>

      {!collapsed && (
        <>
          {/* Group-by toggle */}
          <GroupByRow>
            <GroupByOption
              $active={groupBy === "category"}
              onClick={() => handleGroupByChange("category")}
            >
              By Category
            </GroupByOption>
            <GroupByOption
              $active={groupBy === "facility"}
              onClick={() => handleGroupByChange("facility")}
            >
              By Facility
            </GroupByOption>
          </GroupByRow>

          {/* Tabs (categories or facilities) */}
          <TabBar>
            <Tab
              $active={activeTab === null}
              onClick={() => {
                setActiveTab(null);
                setActiveGroup(null);
              }}
            >
              All
            </Tab>
            {tabs.sort().map((t) => (
              <Tab
                key={t}
                $active={activeTab === t}
                onClick={() => {
                  setActiveTab(t);
                  setActiveGroup(null);
                }}
              >
                {t}
              </Tab>
            ))}
          </TabBar>

          {/* Filters */}
          <FiltersRow>
            {/* Facility dropdown — only shown in category mode */}
            {groupBy === "category" && facilityNames.length > 1 && (
              <GroupSelect
                value={activeFacility ?? ""}
                onChange={(e) => setActiveFacility(e.target.value || null)}
              >
                <option value="">All Facilities</option>
                {facilityNames.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </GroupSelect>
            )}
            {/* Sub-group dropdown */}
            {activeTab && groups.length > 1 && (
              <GroupSelect
                value={activeGroup ?? ""}
                onChange={(e) => setActiveGroup(e.target.value || null)}
              >
                <option value="">
                  All{" "}
                  {groupBy === "category" ? activeTab : "Categories"}
                </option>
                {groups.sort().map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </GroupSelect>
            )}
            <Search
              placeholder="Search blueprints…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </FiltersRow>

          {/* Grid */}
          <Grid>
            {filtered.length === 0 && <Empty>No blueprints found</Empty>}
            {filtered.map((bp) => {
              const tierColor = bp.primaryMetaGroupName
                ? TIER_COLOR[bp.primaryMetaGroupName]
                : undefined;

              return (
                <Card
                  key={bp.blueprintId}
                  $tierColor={tierColor}
                  onClick={() => setSelectedBp(bp)}
                >
                  {bp.primaryIcon && (
                    <CardIcon
                      src={`/${bp.primaryIcon}`}
                      alt={bp.primaryName}
                      loading="lazy"
                    />
                  )}
                  <CardBody>
                    <CardName>{bp.primaryName}</CardName>
                    {bp.primaryGroupName && (
                      <CardGroup>{bp.primaryGroupName}</CardGroup>
                    )}
                    {bp.facilities.length > 0 && (
                      <InputsRow>
                        {bp.facilities.map((f) => (
                          <FacilityBadge key={f.facilityTypeId}>
                            {f.facilityName}
                          </FacilityBadge>
                        ))}
                      </InputsRow>
                    )}
                    <InputsRow>
                      {bp.inputs.slice(0, 4).map((inp) => {
                        const icon = itemIconPath(inp.typeId);
                        return (
                          <InputChip key={inp.typeId}>
                            {icon && (
                              <InputIcon
                                src={`/${icon}`}
                                alt=""
                                loading="lazy"
                              />
                            )}
                            ×{inp.quantity}
                          </InputChip>
                        );
                      })}
                      {bp.inputs.length > 4 && (
                        <InputChip>+{bp.inputs.length - 4}</InputChip>
                      )}
                    </InputsRow>
                    <BadgeRow>
                      <TimeBadge>{bp.runTime}s</TimeBadge>
                      {bp.outputs.length > 1 && (
                        <MultiOutputBadge>
                          {bp.outputs.length} outputs
                        </MultiOutputBadge>
                      )}
                    </BadgeRow>
                  </CardBody>
                </Card>
              );
            })}
          </Grid>
        </>
      )}

      {/* Detail modal */}
      {selectedBp && (
        <BlueprintDetailModal
          blueprint={selectedBp}
          onClose={() => setSelectedBp(null)}
          onResolve={onResolve}
        />
      )}
    </Section>
  );
}
