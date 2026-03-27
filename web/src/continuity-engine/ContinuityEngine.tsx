/**
 * Continuity Engine — iframe wrapper for the puzzle-service.
 *
 * Embeds the Go/HTMX puzzle service as a full-height iframe, passing the
 * connected wallet's address as the `player` query param so the puzzle
 * service can identify the player.
 *
 * Renders a `CormStateBar` above the iframe showing canonical on-chain
 * corm state (phase, stability, corruption). A postMessage bridge
 * (`useCormStateBridge`) forwards state changes into the iframe so the
 * puzzle-service can optionally reconcile.
 */

import { useRef } from "react";
import styled from "styled-components";
import { useIdentity } from "../hooks/useIdentity";
import { config } from "../config";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { CormStateBar } from "./CormStateBar";
import { useCormStateBridge } from "./useCormStateBridge";

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
`;

const Frame = styled.iframe`
  flex: 1;
  width: 100%;
  border: none;
  background: ${({ theme }) => theme.colors.surface.bg};
`;

const NoWallet = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 14px;
`;

export function ContinuityEngine() {
  const { address, isLoading } = useIdentity();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Bridge on-chain state into the puzzle-service iframe
  useCormStateBridge(iframeRef);

  if (isLoading) {
    return (
      <Wrapper>
        <LoadingSpinner />
      </Wrapper>
    );
  }

  if (!address) {
    return (
      <Wrapper>
        <NoWallet>Connect a wallet to access the Continuity Engine.</NoWallet>
      </Wrapper>
    );
  }

  const puzzleUrl = `${config.puzzleServiceUrl}?player=${encodeURIComponent(address)}`;

  return (
    <Wrapper>
      <CormStateBar />
      <Frame ref={iframeRef} src={puzzleUrl} title="Continuity Engine" allow="clipboard-write" />
    </Wrapper>
  );
}

/**
 * Dapp variant — used in the SSU iframe shell (/dapp/continuity/:entityId).
 * Includes the entity_id in the puzzle-service URL path.
 */
export function ContinuityEngineDapp({ entityId }: { entityId?: string }) {
  const { address, isLoading } = useIdentity();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Bridge on-chain state into the puzzle-service iframe
  useCormStateBridge(iframeRef);

  if (isLoading) {
    return (
      <Wrapper>
        <LoadingSpinner />
      </Wrapper>
    );
  }

  if (!address) {
    return (
      <Wrapper>
        <NoWallet>Connect a wallet to access the Continuity Engine.</NoWallet>
      </Wrapper>
    );
  }

  const basePath = entityId ? `/ssu/${entityId}` : "";
  const puzzleUrl = `${config.puzzleServiceUrl}${basePath}?player=${encodeURIComponent(address)}`;

  return (
    <Wrapper>
      <CormStateBar />
      <Frame ref={iframeRef} src={puzzleUrl} title="Continuity Engine" allow="clipboard-write" />
    </Wrapper>
  );
}
