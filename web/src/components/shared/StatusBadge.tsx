import styled from "styled-components";

type BadgeVariant = "open" | "assigned" | "disputed" | "active" | "in-progress" | "completed" | "cancelled" | "expired";

const variantColors: Record<BadgeVariant, { bg: string; text: string }> = {
  open: { bg: "#1a3a2a", text: "#81C784" },
  assigned: { bg: "#1a2a3a", text: "#4FC3F7" },
  disputed: { bg: "#3a1a1a", text: "#FB2C36" },
  active: { bg: "#1a2a3a", text: "#4FC3F7" },
  "in-progress": { bg: "#2a2a1a", text: "#FFB651" },
  completed: { bg: "#2a2a1a", text: "#FAFAE5" },
  cancelled: { bg: "#2a2020", text: "#9E7B72" },
  expired: { bg: "#2a2020", text: "#9E7B72" },
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
