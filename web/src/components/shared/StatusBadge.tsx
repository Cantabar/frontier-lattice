import styled from "styled-components";

type BadgeVariant = "open" | "assigned" | "disputed" | "active" | "in-progress" | "completed" | "cancelled" | "expired";

const variantColors: Record<BadgeVariant, { bg: string; text: string }> = {
  open: { bg: "#0D3B4A", text: "#69F0AE" },
  assigned: { bg: "#1C2330", text: "#00E5FF" },
  disputed: { bg: "#3A1520", text: "#FF5252" },
  active: { bg: "#1C2330", text: "#00E5FF" },
  "in-progress": { bg: "#2A2510", text: "#FFD740" },
  completed: { bg: "#0F2A1C", text: "#69F0AE" },
  cancelled: { bg: "#1C2330", text: "#546E7A" },
  expired: { bg: "#1C2330", text: "#546E7A" },
};

const Badge = styled.span<{ $variant: BadgeVariant }>`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ $variant }) => variantColors[$variant].bg};
  color: ${({ $variant }) => variantColors[$variant].text};
  text-transform: capitalize;
`;

export function StatusBadge({ status }: { status: BadgeVariant }) {
  return <Badge $variant={status}>{status}</Badge>;
}
