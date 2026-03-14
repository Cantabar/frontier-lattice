/**
 * Displays a character's portrait and name resolved from the on-chain
 * Character object. Falls back to a coloured circle + truncated ID while
 * loading or when metadata is unavailable.
 */

import styled from "styled-components";
import { truncateAddress, generateAvatarColor } from "../../lib/format";
import type { CharacterProfile } from "../../lib/types";
import { useCharacterProfile } from "../../hooks/useCharacterProfile";

// ---------------------------------------------------------------------------
// Styled primitives
// ---------------------------------------------------------------------------

const Wrapper = styled.span<{ $size: "sm" | "md" }>`
  display: inline-flex;
  align-items: center;
  gap: ${({ $size }) => ($size === "sm" ? "6px" : "8px")};
  max-width: 100%;
`;

const Portrait = styled.img<{ $size: "sm" | "md" }>`
  width: ${({ $size }) => ($size === "sm" ? "20px" : "28px")};
  height: ${({ $size }) => ($size === "sm" ? "20px" : "28px")};
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
`;

const Placeholder = styled.span<{ $size: "sm" | "md"; $color: string }>`
  display: inline-block;
  width: ${({ $size }) => ($size === "sm" ? "20px" : "28px")};
  height: ${({ $size }) => ($size === "sm" ? "20px" : "28px")};
  border-radius: 50%;
  background: ${({ $color }) => $color};
  flex-shrink: 0;
`;

const Name = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// ---------------------------------------------------------------------------
// Inner component that renders from an already-resolved profile
// ---------------------------------------------------------------------------

function Resolved({
  profile,
  characterId,
  showPortrait,
  size,
}: {
  profile: CharacterProfile | null;
  characterId: string;
  showPortrait: boolean;
  size: "sm" | "md";
}) {
  const displayName = profile?.name || truncateAddress(characterId);
  const portraitUrl = profile?.portraitUrl || "";
  const avatarColor = generateAvatarColor(characterId);

  return (
    <Wrapper $size={size} title={characterId}>
      {showPortrait &&
        (portraitUrl ? (
          <Portrait src={portraitUrl} alt={displayName} $size={size} />
        ) : (
          <Placeholder $size={size} $color={avatarColor} />
        ))}
      <Name>{displayName}</Name>
    </Wrapper>
  );
}

// ---------------------------------------------------------------------------
// Self-fetching variant (calls useCharacterProfile internally)
// ---------------------------------------------------------------------------

interface CharacterDisplayProps {
  characterId: string;
  /** Show portrait circle (default true) */
  showPortrait?: boolean;
  /** Size variant (default "sm") */
  size?: "sm" | "md";
}

export function CharacterDisplay({
  characterId,
  showPortrait = true,
  size = "sm",
}: CharacterDisplayProps) {
  const { profile } = useCharacterProfile(characterId);

  return (
    <Resolved
      profile={profile}
      characterId={characterId}
      showPortrait={showPortrait}
      size={size}
    />
  );
}

// ---------------------------------------------------------------------------
// Pre-resolved variant (for list views that batch-fetch profiles)
// ---------------------------------------------------------------------------

interface ResolvedCharacterDisplayProps {
  characterId: string;
  profile: CharacterProfile | null;
  showPortrait?: boolean;
  size?: "sm" | "md";
}

export function ResolvedCharacterDisplay({
  characterId,
  profile,
  showPortrait = true,
  size = "sm",
}: ResolvedCharacterDisplayProps) {
  return (
    <Resolved
      profile={profile}
      characterId={characterId}
      showPortrait={showPortrait}
      size={size}
    />
  );
}
