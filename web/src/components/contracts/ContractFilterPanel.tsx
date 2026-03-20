/**
 * Collapsible advanced-filter panel for the Trustless Contracts page.
 *
 * Renders compact picker triggers for item-wanted, item-offered,
 * poster character, and tribe. Reuses the existing modal pickers.
 */

import { useState } from "react";
import styled from "styled-components";
import { ItemPickerModal } from "../shared/ItemPickerModal";
import { CharacterPickerModal } from "../shared/CharacterPickerModal";
import { TribePickerModal } from "../shared/TribePickerModal";
import { useItems } from "../../hooks/useItems";
import { useCharacters } from "../../hooks/useCharacters";
import { useAllTribes } from "../../hooks/useAllTribes";
import { truncateAddress } from "../../lib/format";
import { regionName, constellationName } from "../../lib/regions";
import type { InGameTribe } from "../../lib/types";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Wrapper = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const ToggleButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.subtle : theme.colors.surface.raised};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary.subtle : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  background: ${({ theme }) => theme.colors.primary.main};
  color: ${({ theme }) => theme.colors.surface.bg};
  font-size: 11px;
  font-weight: 700;
  padding: 0 4px;
`;

const Panel = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: flex-start;
  margin-top: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
`;

const FilterGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
`;

const FilterLabel = styled.span`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const Trigger = styled.button`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 6px 10px;
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const Placeholder = styled.span`
  color: ${({ theme }) => theme.colors.text.muted};
`;

const SmallIcon = styled.img`
  width: 18px;
  height: 18px;
  object-fit: contain;
  flex-shrink: 0;
`;

const ClearBtn = styled.button`
  align-self: flex-end;
  margin-left: auto;
  background: transparent;
  color: ${({ theme }) => theme.colors.text.muted};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const RemoveIcon = styled.span`
  margin-left: 4px;
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: pointer;
  font-size: 14px;
  line-height: 1;

  &:hover {
    color: ${({ theme }) => theme.colors.danger};
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tribeName(t: InGameTribe): string {
  if (t.onChainTribe) return t.onChainTribe.name;
  if (t.worldInfo) return t.worldInfo.name;
  return `Tribe #${t.inGameTribeId}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  wantedItemTypeId: number | null;
  onWantedItemChange: (id: number | null) => void;
  offeredItemTypeId: number | null;
  onOfferedItemChange: (id: number | null) => void;
  posterCharacterId: string | null;
  onPosterChange: (id: string | null) => void;
  filterTribeId: number | null;
  onTribeChange: (id: number | null) => void;
  filterRegionId: number | null;
  onRegionChange: (id: number | null) => void;
  filterConstellationId: number | null;
  onConstellationChange: (id: number | null) => void;
  activeCount: number;
  onClearAll: () => void;
}

export function ContractFilterPanel({
  wantedItemTypeId,
  onWantedItemChange,
  offeredItemTypeId,
  onOfferedItemChange,
  posterCharacterId,
  onPosterChange,
  filterTribeId,
  onTribeChange,
  filterRegionId,
  onRegionChange,
  filterConstellationId,
  onConstellationChange,
  activeCount,
  onClearAll,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  // Modal open state
  const [wantedModal, setWantedModal] = useState(false);
  const [offeredModal, setOfferedModal] = useState(false);
  const [charModal, setCharModal] = useState(false);
  const [tribeModal, setTribeModal] = useState(false);

  // Data for display labels
  const { getItem } = useItems();
  const { characters } = useCharacters();
  const { allTribes } = useAllTribes();

  const wantedItem = wantedItemTypeId ? getItem(wantedItemTypeId) : undefined;
  const offeredItem = offeredItemTypeId ? getItem(offeredItemTypeId) : undefined;
  const posterChar = posterCharacterId
    ? characters.find((c) => c.characterId === posterCharacterId)
    : undefined;
  const filterTribe = filterTribeId != null
    ? allTribes.find((t) => t.inGameTribeId === filterTribeId)
    : undefined;

  return (
    <Wrapper>
      <ToggleRow>
        <ToggleButton $active={expanded || activeCount > 0} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "▾ Filters" : "▸ Filters"}
          {activeCount > 0 && <Badge>{activeCount}</Badge>}
        </ToggleButton>
      </ToggleRow>

      {expanded && (
        <Panel>
          {/* Item Wanted */}
          <FilterGroup>
            <FilterLabel>Item Wanted</FilterLabel>
            <Trigger type="button" onClick={() => setWantedModal(true)}>
              {wantedItem ? (
                <>
                  <SmallIcon src={`/${wantedItem.icon}`} alt={wantedItem.name} />
                  {wantedItem.name}
                  <RemoveIcon onClick={(e) => { e.stopPropagation(); onWantedItemChange(null); }}>×</RemoveIcon>
                </>
              ) : (
                <Placeholder>Any item…</Placeholder>
              )}
            </Trigger>
          </FilterGroup>

          {/* Item Offered */}
          <FilterGroup>
            <FilterLabel>Item Offered</FilterLabel>
            <Trigger type="button" onClick={() => setOfferedModal(true)}>
              {offeredItem ? (
                <>
                  <SmallIcon src={`/${offeredItem.icon}`} alt={offeredItem.name} />
                  {offeredItem.name}
                  <RemoveIcon onClick={(e) => { e.stopPropagation(); onOfferedItemChange(null); }}>×</RemoveIcon>
                </>
              ) : (
                <Placeholder>Any item…</Placeholder>
              )}
            </Trigger>
          </FilterGroup>

          {/* Poster Character */}
          <FilterGroup>
            <FilterLabel>Poster</FilterLabel>
            <Trigger type="button" onClick={() => setCharModal(true)}>
              {posterChar ? (
                <>
                  {posterChar.name || truncateAddress(posterChar.characterId, 6, 4)}
                  <RemoveIcon onClick={(e) => { e.stopPropagation(); onPosterChange(null); }}>×</RemoveIcon>
                </>
              ) : posterCharacterId ? (
                <>
                  {truncateAddress(posterCharacterId, 6, 4)}
                  <RemoveIcon onClick={(e) => { e.stopPropagation(); onPosterChange(null); }}>×</RemoveIcon>
                </>
              ) : (
                <Placeholder>Any poster…</Placeholder>
              )}
            </Trigger>
          </FilterGroup>

          {/* Tribe */}
          <FilterGroup>
            <FilterLabel>Tribe</FilterLabel>
            <Trigger type="button" onClick={() => setTribeModal(true)}>
              {filterTribe ? (
                <>
                  {tribeName(filterTribe)}
                  <RemoveIcon onClick={(e) => { e.stopPropagation(); onTribeChange(null); }}>×</RemoveIcon>
                </>
              ) : filterTribeId != null ? (
                <>
                  Tribe #{filterTribeId}
                  <RemoveIcon onClick={(e) => { e.stopPropagation(); onTribeChange(null); }}>×</RemoveIcon>
                </>
              ) : (
                <Placeholder>Any tribe…</Placeholder>
              )}
            </Trigger>
          </FilterGroup>

          {/* Region */}
          <FilterGroup>
            <FilterLabel>Region</FilterLabel>
            <Trigger
              type="button"
              onClick={() => {
                const input = prompt("Enter a region ID (e.g. 10000005):");
                if (input) {
                  const id = Number(input);
                  if (!Number.isNaN(id)) onRegionChange(id);
                }
              }}
            >
              {filterRegionId != null ? (
                <>
                  {regionName(filterRegionId)}
                  <RemoveIcon onClick={(e) => { e.stopPropagation(); onRegionChange(null); }}>×</RemoveIcon>
                </>
              ) : (
                <Placeholder>Any region…</Placeholder>
              )}
            </Trigger>
          </FilterGroup>

          {/* Constellation */}
          <FilterGroup>
            <FilterLabel>Constellation</FilterLabel>
            <Trigger
              type="button"
              onClick={() => {
                const input = prompt("Enter a constellation ID (e.g. 20000005):");
                if (input) {
                  const id = Number(input);
                  if (!Number.isNaN(id)) onConstellationChange(id);
                }
              }}
            >
              {filterConstellationId != null ? (
                <>
                  {constellationName(filterConstellationId)}
                  <RemoveIcon onClick={(e) => { e.stopPropagation(); onConstellationChange(null); }}>×</RemoveIcon>
                </>
              ) : (
                <Placeholder>Any constellation…</Placeholder>
              )}
            </Trigger>
          </FilterGroup>

          {activeCount > 0 && (
            <ClearBtn onClick={onClearAll}>Clear All</ClearBtn>
          )}

          {/* ── Modals ─────────────────────────────────────────── */}

          {wantedModal && (
            <ItemPickerModal
              onSelect={(typeId) => { onWantedItemChange(typeId); setWantedModal(false); }}
              onClose={() => setWantedModal(false)}
            />
          )}

          {offeredModal && (
            <ItemPickerModal
              onSelect={(typeId) => { onOfferedItemChange(typeId); setOfferedModal(false); }}
              onClose={() => setOfferedModal(false)}
            />
          )}

          {charModal && (
            <CharacterPickerModal
              selected={posterCharacterId ? [posterCharacterId] : []}
              onDone={(ids) => onPosterChange(ids[0] ?? null)}
              onClose={() => setCharModal(false)}
            />
          )}

          {tribeModal && (
            <TribePickerModal
              selected={filterTribeId != null ? [filterTribeId] : []}
              onDone={(ids) => onTribeChange(ids[0] ?? null)}
              onClose={() => setTribeModal(false)}
            />
          )}
        </Panel>
      )}
    </Wrapper>
  );
}
