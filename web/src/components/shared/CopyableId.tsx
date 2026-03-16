/**
 * Displays a truncated Sui address / object ID with:
 * - a copy-to-clipboard button (icon to the right)
 * - a hover tooltip showing the full ID
 *
 * Drop-in replacement for inline `truncateAddress()` calls.
 */

import { useRef, useState, useCallback } from "react";
import styled from "styled-components";
import { truncateAddress } from "../../lib/format";
import { PortalTooltip } from "./PortalTooltip";

// ---------------------------------------------------------------------------
// Styled primitives
// ---------------------------------------------------------------------------

const Wrapper = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: default;
`;

const IdText = styled.span`
  /* inherits font from parent — works inside both <span> and <code> contexts */
`;

const CopyBtn = styled.button`
  all: unset;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 12px;
  line-height: 1;
  padding: 0 2px;
  flex-shrink: 0;
  transition: color 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const FullId = styled.span`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.secondary};
  user-select: all;
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CopyableIdProps {
  /** Full Sui address or object ID. */
  id: string;
  /** Characters to show at the start (default 6). */
  startLen?: number;
  /** Characters to show at the end (default 4). */
  endLen?: number;
  /** Render the text portion as `<code>` instead of `<span>`. */
  asCode?: boolean;
}

export function CopyableId({
  id,
  startLen = 6,
  endLen = 4,
  asCode = false,
}: CopyableIdProps) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(id).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [id],
  );

  const truncated = truncateAddress(id, startLen, endLen);
  const TextTag = asCode ? "code" : "span";

  return (
    <>
      <Wrapper
        ref={wrapperRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <IdText as={TextTag}>{truncated}</IdText>
        <CopyBtn
          onClick={handleCopy}
          title="Copy full ID"
          aria-label="Copy full ID"
        >
          {copied ? "✓" : "⧉"}
        </CopyBtn>
      </Wrapper>

      <PortalTooltip targetRef={wrapperRef} visible={hovered}>
        <FullId>{id}</FullId>
      </PortalTooltip>
    </>
  );
}
