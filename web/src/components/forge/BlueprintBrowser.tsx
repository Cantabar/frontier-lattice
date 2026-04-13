import React, { useMemo, useState } from "react";
import styled from "styled-components";
import type { BlueprintEntry } from "../../hooks/useBlueprints";
import { useItems } from "../../hooks/useItems";
import { BlueprintDetailModal } from "./BlueprintDetailModal";
import { CustomSelect } from "../shared/CustomSelect";

// ── Tier color map (matches theme.colors.tier) ─────────────────

const TIER_COLOR: Record<string, string> = {
  Basic: "#666666",
  Standard: "#b0b0b0",
  Enhanced: "#4caf50",
  Prototype: "#42a5f5",
  Experimental: "#ab47bc",
  Exotic: "#ffd740",
};

// ── Types ───────────────────────────────────────────────────────

type GroupBy = "category" | "facility";
type SortKey = "name" | "techLevel" | "size" | "moduleSlot" | "runTime";

const TIER_ORDER: Record<string, number> = {
  Basic: 0,
  Standard: 1,
  Enhanced: 2,
  Prototype: 3,
  Experimental: 4,
  Exotic: 5,
};

const TIERS = Object.keys(TIER_ORDER);

const SIZE_ORDER: Record<string, number> = { small: 0, medium: 1, large: 2 };
const SLOT_ORDER: Record<string, number> = { high: 0, mid: 1, low: 2, engine: 3 };

const SLOT_LABELS: Record<string, string> = {
  high: "High",
  mid: "Mid",
  low: "Low",
  engine: "Engine",
};

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "techLevel", label: "Tech Level" },
  { key: "size", label: "Size" },
  { key: "moduleSlot", label: "Module Slot" },
  { key: "runTime", label: "Run Time" },
];

// ── Styled components ──────────────────────────────────────────

const Section = styled.section`
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin: 0 0 ${({ theme }) => theme.spacing.md};
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

const FilterPanel = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const FilterPanelHeader = styled.div`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${({ theme }) => theme.colors.primary.muted};
  margin-bottom: 2px;
`;

const FilterGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const FilterLabel = styled.span`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  padding-right: 2px;
  white-space: nowrap;
  user-select: none;
  min-width: 60px;
`;

const FamilyLabel = styled.span`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  padding: 4px 6px 4px 2px;
  white-space: nowrap;
  user-select: none;
`;

const Chip = styled.button<{ $active: boolean }>`
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

const TierChip = styled(Chip)<{ $tierColor?: string }>`
  ${({ $active, $tierColor }) =>
    $active && $tierColor
      ? `border-color: ${$tierColor}; color: ${$tierColor}; background: ${$tierColor}18;`
      : ""}
  ${({ $active, $tierColor }) =>
    !$active && $tierColor ? `color: ${$tierColor};` : ""}
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

const SortBar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const SortLabel = styled.span`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  padding-right: 2px;
  white-space: nowrap;
  user-select: none;
`;

const SortButton = styled.button<{ $active: boolean }>`
  padding: 3px 8px;
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.secondary.accent : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.secondary.accentMuted : "transparent"};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.text.primary : theme.colors.text.muted};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    border-color: ${({ theme }) => theme.colors.secondary.accent};
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
  color: ${({ theme }) => theme.colors.module.forge};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.module.forge};
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

// ── Facility size rank (Field → Mini → base → Heavy) ──────────

function facilitySize(name: string): number {
  if (name.startsWith("Field")) return 0;
  if (name.startsWith("Mini")) return 1;
  if (name.startsWith("Heavy")) return 3;
  return 2; // base / unprefixed
}

// ── Component ──────────────────────────────────────────────────

interface Props {
  blueprints: BlueprintEntry[];
  onResolve?: (outputTypeId: number) => void;
}

export function BlueprintBrowser({ blueprints, onResolve }: Props) {
  const { getItem } = useItems();

  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [activeFacility, setActiveFacility] = useState<string | null>(null);
  const [activeTier, setActiveTier] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
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

  // Facilities grouped by family: Map<family, sorted facilityName[]>
  const facilityByFamily = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const bp of blueprints) {
      for (const f of bp.facilities) {
        if (!map.has(f.facilityFamily)) map.set(f.facilityFamily, []);
        const arr = map.get(f.facilityFamily)!;
        if (!arr.includes(f.facilityName)) arr.push(f.facilityName);
      }
    }
    for (const arr of map.values())
      arr.sort((a, b) => facilitySize(a) - facilitySize(b));
    return map;
  }, [blueprints]);

  const familyOrder = useMemo(
    () => [...facilityByFamily.keys()].sort(),
    [facilityByFamily],
  );

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
      subset = subset.filter((b) =>
        b.facilities.some((f) => f.facilityName === activeTab),
      );
      return [
        ...new Set(subset.map((b) => b.primaryCategoryName).filter(Boolean)),
      ] as string[];
    }
  }, [blueprints, activeTab, groupBy]);

  // Show slot filter when Module category is active (or "All" with modules present)
  const showSlotFilter = activeTab === "Module" || activeTab === null;

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

    // Facility dropdown filter
    if (activeFacility) {
      list = list.filter((b) =>
        b.facilities.some((f) => f.facilityName === activeFacility),
      );
    }

    // Tier filter
    if (activeTier) {
      list = list.filter((b) => b.primaryMetaGroupName === activeTier);
    }

    // Slot type filter
    if (activeSlot) {
      list = list.filter((b) => b.slotType === activeSlot);
    }

    // Text search (blueprint name, ID, product name, or input material name)
    const q = query.toLowerCase().trim();
    if (q) {
      list = list.filter(
        (b) =>
          b.primaryName.toLowerCase().includes(q) ||
          String(b.blueprintId).includes(q) ||
          b.outputs.some((o) =>
            getItem(o.typeId)?.name?.toLowerCase().includes(q),
          ) ||
          b.inputs.some((i) =>
            getItem(i.typeId)?.name?.toLowerCase().includes(q),
          ),
      );
    }

    return list;
  }, [blueprints, activeTab, activeGroup, activeFacility, activeTier, activeSlot, groupBy, query, getItem]);

  // Sorted list
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;

    const dir = sortDir === "asc" ? 1 : -1;

    const rankWithNull = (
      a: string | null,
      b: string | null,
      order: Record<string, number>,
    ): number => {
      const ra = a != null ? (order[a] ?? 999) : 999;
      const rb = b != null ? (order[b] ?? 999) : 999;
      return (ra - rb) * dir;
    };

    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.primaryName.localeCompare(b.primaryName) * dir;
        case "techLevel":
          return rankWithNull(
            a.primaryMetaGroupName,
            b.primaryMetaGroupName,
            TIER_ORDER,
          );
        case "size":
          return rankWithNull(a.sizeClass, b.sizeClass, SIZE_ORDER);
        case "moduleSlot":
          return rankWithNull(a.slotType, b.slotType, SLOT_ORDER);
        case "runTime":
          return (a.runTime - b.runTime) * dir;
        default:
          return 0;
      }
    });
  }, [filtered, sortKey, sortDir]);

  function itemIconPath(typeId: number): string {
    return getItem(typeId)?.icon ?? "";
  }

  function handleGroupByChange(mode: GroupBy) {
    setGroupBy(mode);
    setActiveTab(null);
    setActiveGroup(null);
    if (mode === "facility") setActiveFacility(null);
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <Section>
      <SectionHeader>
        <CountBadge>{sorted.length} blueprints</CountBadge>
      </SectionHeader>

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

      {/* ── Filter Panel ─────────────────────────────────────── */}
      <FilterPanel>
        <FilterPanelHeader>Filters</FilterPanelHeader>

        {/* Search */}
        <Search
          placeholder="Search blueprints or products…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {/* Category / Facility tabs */}
        <FilterGroup>
          <FilterLabel>
            {groupBy === "category" ? "Category" : "Facility"}
          </FilterLabel>
          <Chip
            $active={activeTab === null}
            onClick={() => {
              setActiveTab(null);
              setActiveGroup(null);
            }}
          >
            All
          </Chip>
          {groupBy === "category"
            ? tabs.sort().map((t) => (
                <Chip
                  key={t}
                  $active={activeTab === t}
                  onClick={() => {
                    setActiveTab(t);
                    setActiveGroup(null);
                  }}
                >
                  {t}
                </Chip>
              ))
            : familyOrder.map((family) => (
                <React.Fragment key={family}>
                  <FamilyLabel>{family}</FamilyLabel>
                  {facilityByFamily.get(family)!.map((name) => (
                    <Chip
                      key={name}
                      $active={activeTab === name}
                      onClick={() => {
                        setActiveTab(name);
                        setActiveGroup(null);
                      }}
                    >
                      {name}
                    </Chip>
                  ))}
                </React.Fragment>
              ))}
        </FilterGroup>

        {/* Tier filter */}
        <FilterGroup>
          <FilterLabel>Tier</FilterLabel>
          <TierChip
            $active={activeTier === null}
            onClick={() => setActiveTier(null)}
          >
            All
          </TierChip>
          {TIERS.map((t) => (
            <TierChip
              key={t}
              $active={activeTier === t}
              $tierColor={TIER_COLOR[t]}
              onClick={() => setActiveTier(activeTier === t ? null : t)}
            >
              {t}
            </TierChip>
          ))}
        </FilterGroup>

        {/* Slot type filter — visible when Module category active or All */}
        {showSlotFilter && (
          <FilterGroup>
            <FilterLabel>Slot</FilterLabel>
            <Chip
              $active={activeSlot === null}
              onClick={() => setActiveSlot(null)}
            >
              All
            </Chip>
            {Object.entries(SLOT_LABELS).map(([key, label]) => (
              <Chip
                key={key}
                $active={activeSlot === key}
                onClick={() => setActiveSlot(activeSlot === key ? null : key)}
              >
                {label}
              </Chip>
            ))}
          </FilterGroup>
        )}

        {/* Facility dropdown — only in category mode */}
        {groupBy === "category" && facilityNames.length > 1 && (
          <FilterGroup>
            <FilterLabel>Facility</FilterLabel>
            <CustomSelect
              value={activeFacility ?? ""}
              onChange={(v) => setActiveFacility(v || null)}
              compact
              fullWidth={false}
              optgroups={[
                { label: "", options: [{ value: "", label: "All Facilities" }] },
                ...familyOrder.map((family) => ({
                  label: family,
                  options: facilityByFamily.get(family)!.map((name) => ({
                    value: name,
                    label: name,
                  })),
                })),
              ]}
            />
          </FilterGroup>
        )}

        {/* Sub-group dropdown */}
        {activeTab && groups.length > 1 && (
          <FilterGroup>
            <FilterLabel>Group</FilterLabel>
            <CustomSelect
              value={activeGroup ?? ""}
              onChange={(v) => setActiveGroup(v || null)}
              compact
              fullWidth={false}
              options={[
                { value: "", label: `All ${groupBy === "category" ? activeTab : "Categories"}` },
                ...groups.sort().map((g) => ({ value: g, label: g })),
              ]}
            />
          </FilterGroup>
        )}
      </FilterPanel>

      {/* ── Sort Bar ─────────────────────────────────────────── */}
      <SortBar>
        <SortLabel>Sort</SortLabel>
        {SORT_OPTIONS.map(({ key, label }) => (
          <SortButton
            key={key}
            $active={sortKey === key}
            onClick={() => handleSort(key)}
          >
            {label}
            {sortKey === key && (sortDir === "asc" ? " ▲" : " ▼")}
          </SortButton>
        ))}
        {sortKey && (
          <SortButton
            $active={false}
            onClick={() => {
              setSortKey(null);
              setSortDir("asc");
            }}
          >
            ✕
          </SortButton>
        )}
      </SortBar>

      {/* Grid */}
      <Grid>
        {sorted.length === 0 && <Empty>No blueprints found</Empty>}
        {sorted.map((bp) => {
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
