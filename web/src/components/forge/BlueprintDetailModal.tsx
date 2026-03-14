import styled from "styled-components";
import { Modal } from "../shared/Modal";
import { useItems } from "../../hooks/useItems";
import type { BlueprintEntry } from "../../hooks/useBlueprints";

// ── Tier color map ─────────────────────────────────────────────

const TIER_COLOR: Record<string, string> = {
  Basic: "#666666",
  Standard: "#b0b0b0",
  Enhanced: "#4caf50",
  Prototype: "#42a5f5",
  Experimental: "#ab47bc",
  Exotic: "#ffd740",
};

// ── Styled components ──────────────────────────────────────────

const HeroRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const HeroIcon = styled.img`
  width: 64px;
  height: 64px;
  object-fit: contain;
  flex-shrink: 0;
`;

const HeroInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const HeroName = styled.h3`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: 0;
`;

const HeroMeta = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: 2px;
`;

const TierBadge = styled.span<{ $color: string }>`
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ $color }) => $color};
  border: 1px solid ${({ $color }) => $color};
  border-radius: 3px;
  padding: 1px 6px;
  margin-left: ${({ theme }) => theme.spacing.sm};
`;

const RunTimeBadge = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 2px 8px;
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  margin: ${({ theme }) => theme.spacing.md} 0;
`;

const SectionLabel = styled.h4`
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`;

const ItemRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.xs} 0;

  & + & {
    border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  }
`;

const ItemIcon = styled.img`
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
`;

const ItemName = styled.span`
  flex: 1;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const ItemQty = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
`;

const ItemGroup = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  white-space: nowrap;
`;

const Arrow = styled.div`
  text-align: center;
  font-size: 20px;
  color: ${({ theme }) => theme.colors.module.forgePlanner};
  padding: ${({ theme }) => theme.spacing.xs} 0;
`;

const ActionButton = styled.button`
  width: 100%;
  margin-top: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.primary.main};
  color: #0f1318;
  border: none;
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.hover};
  }
`;

// ── Component ──────────────────────────────────────────────────

interface Props {
  blueprint: BlueprintEntry;
  onClose: () => void;
  onResolve?: (outputTypeId: number) => void;
}

export function BlueprintDetailModal({ blueprint, onClose, onResolve }: Props) {
  const { getItem } = useItems();

  function itemName(typeId: number): string {
    return getItem(typeId)?.name ?? `Type ${typeId}`;
  }

  function itemIcon(typeId: number): string {
    return getItem(typeId)?.icon ?? "";
  }

  function itemGroup(typeId: number): string | null {
    return getItem(typeId)?.groupName ?? null;
  }

  const tierColor = blueprint.primaryMetaGroupName
    ? TIER_COLOR[blueprint.primaryMetaGroupName]
    : undefined;

  return (
    <Modal title="Blueprint" onClose={onClose}>
      {/* Hero */}
      <HeroRow>
        {blueprint.primaryIcon && (
          <HeroIcon src={`/${blueprint.primaryIcon}`} alt={blueprint.primaryName} />
        )}
        <HeroInfo>
          <HeroName>
            {blueprint.primaryName}
            {tierColor && blueprint.primaryMetaGroupName && (
              <TierBadge $color={tierColor}>{blueprint.primaryMetaGroupName}</TierBadge>
            )}
          </HeroName>
          <HeroMeta>
            {[blueprint.primaryCategoryName, blueprint.primaryGroupName]
              .filter(Boolean)
              .join(" · ")}
            {" · "}
            <RunTimeBadge>{blueprint.runTime}s</RunTimeBadge>
          </HeroMeta>
        </HeroInfo>
      </HeroRow>

      {/* Inputs */}
      <Divider />
      <SectionLabel>Inputs</SectionLabel>
      {blueprint.inputs.map((inp) => {
        const icon = itemIcon(inp.typeId);
        const group = itemGroup(inp.typeId);
        return (
          <ItemRow key={inp.typeId}>
            {icon && <ItemIcon src={`/${icon}`} alt="" />}
            <ItemName>{itemName(inp.typeId)}</ItemName>
            {group && <ItemGroup>{group}</ItemGroup>}
            <ItemQty>×{inp.quantity}</ItemQty>
          </ItemRow>
        );
      })}

      {/* Arrow */}
      <Arrow>▼</Arrow>

      {/* Outputs */}
      <SectionLabel>Outputs</SectionLabel>
      {blueprint.outputs.map((out) => {
        const icon = itemIcon(out.typeId);
        const group = itemGroup(out.typeId);
        return (
          <ItemRow key={out.typeId}>
            {icon && <ItemIcon src={`/${icon}`} alt="" />}
            <ItemName>{itemName(out.typeId)}</ItemName>
            {group && <ItemGroup>{group}</ItemGroup>}
            <ItemQty>×{out.quantity}</ItemQty>
          </ItemRow>
        );
      })}

      {/* Built At — facilities */}
      {blueprint.facilities.length > 0 && (
        <>
          <Divider />
          <SectionLabel>Built At</SectionLabel>
          {blueprint.facilities.map((f) => (
            <ItemRow key={f.facilityTypeId}>
              <ItemName>{f.facilityName}</ItemName>
            </ItemRow>
          ))}
        </>
      )}

      {/* Resolve button */}
      {onResolve && (
        <ActionButton
          onClick={() => {
            onResolve(blueprint.outputs[0]?.typeId ?? blueprint.primaryTypeId);
            onClose();
          }}
        >
          Resolve in Optimizer
        </ActionButton>
      )}
    </Modal>
  );
}
