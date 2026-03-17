import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import styled from "styled-components";
import { useSuiClientQuery } from "@mysten/dapp-kit";
import { useIdentity } from "../hooks/useIdentity";
import { useContractsForSsu } from "../hooks/useContractsForSsu";
import { useSsuInventory } from "../hooks/useSsuInventory";
import { DappContractCard } from "../components/dapp/DappContractCard";
import { DappDeliverModal } from "../components/dapp/DappDeliverModal";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { CopyableId } from "../components/shared/CopyableId";
import type { TrustlessContractData } from "../lib/types";

// ---------------------------------------------------------------------------
// Styled
// ---------------------------------------------------------------------------

const Page = styled.div`
  width: 100%;
  max-width: 550px;
  margin: 0 auto;
  padding: ${({ theme }) => theme.spacing.md};
  min-height: 100vh;
`;

const SsuHeader = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SsuName = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const SsuId = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  font-family: ${({ theme }) => theme.fonts.mono};
`;

const InventorySummary = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-top: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border-radius: ${({ theme }) => theme.radii.sm};
`;

const SectionTitle = styled.h2`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.lg};
`;

const FulfillableLabel = styled(SectionTitle)`
  color: ${({ theme }) => theme.colors.success};
`;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Count = styled.span`
  font-weight: 400;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 12px;
  margin-left: ${({ theme }) => theme.spacing.xs};
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SsuDeliveryDapp() {
  const { ssuId } = useParams<{ ssuId: string }>();
  const { characterOwnerCapId } = useIdentity();
  const [deliverTarget, setDeliverTarget] = useState<TrustlessContractData | null>(null);

  // Fetch SSU object for name/metadata
  const { data: ssuObject, isLoading: ssuLoading } = useSuiClientQuery(
    "getObject",
    { id: ssuId!, options: { showContent: true } },
    { enabled: !!ssuId },
  );

  const ssuFields = (ssuObject?.data?.content as { fields?: Record<string, unknown> })?.fields;
  const ssuMeta = (ssuFields?.metadata as { fields?: { name?: string } })?.fields;
  const ssuName = ssuMeta?.name || "Storage Unit";
  const ownerCapId = ssuFields?.owner_cap_id as string | undefined;

  // Fetch inventory for this SSU
  const { slots, isLoading: invLoading } = useSsuInventory(ssuId, ownerCapId, !!ssuId && !!ownerCapId);

  // Flatten all inventory items from all slots (for SSU summary display)
  const allItems = useMemo(() => slots.flatMap((s) => s.items), [slots]);

  // Items from the current user's player inventory slot only
  const userItems = useMemo(
    () => slots
      .filter((s) => s.key === characterOwnerCapId)
      .flatMap((s) => s.items),
    [slots, characterOwnerCapId],
  );

  const totalItemCount = useMemo(
    () => allItems.reduce((sum, i) => sum + i.quantity, 0),
    [allItems],
  );
  const uniqueTypes = useMemo(
    () => new Set(allItems.map((i) => i.typeId)).size,
    [allItems],
  );

  // Fetch and filter contracts for this SSU using only the user's items
  const {
    fulfillableContracts,
    otherContracts,
    isLoading: contractsLoading,
    refetch,
  } = useContractsForSsu(ssuId, userItems);

  const isLoading = ssuLoading || invLoading || contractsLoading;

  if (!ssuId) {
    return (
      <Page>
        <EmptyState title="No SSU specified" description="This dApp requires an SSU ID in the URL." />
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page>
        <LoadingSpinner />
      </Page>
    );
  }

  const fulfillableSet = new Set(fulfillableContracts.map((c) => c.id));

  return (
    <Page>
      <SsuHeader>
        <SsuName>{ssuName}</SsuName>
        <SsuId><CopyableId id={ssuId} startLen={10} endLen={8} /></SsuId>
        <InventorySummary>
          <span>{totalItemCount.toLocaleString()} items</span>
          <span>{uniqueTypes} types</span>
          <span>{slots.length} inventory slots</span>
        </InventorySummary>
      </SsuHeader>

      {fulfillableContracts.length === 0 && otherContracts.length === 0 ? (
        <EmptyState
          title="No contracts for this SSU"
          description="There are no active contracts associated with this storage unit."
        />
      ) : (
        <>
          {fulfillableContracts.length > 0 && (
            <>
              <FulfillableLabel>
                You Can Deliver
                <Count>({fulfillableContracts.length})</Count>
              </FulfillableLabel>
              <CardList>
                {fulfillableContracts.map((c) => (
                  <DappContractCard
                    key={c.id}
                    contract={c}
                    canFulfill
                    onDeliver={() => setDeliverTarget(c)}
                  />
                ))}
              </CardList>
            </>
          )}

          {otherContracts.length > 0 && (
            <>
              <SectionTitle>
                All Contracts
                <Count>({otherContracts.length})</Count>
              </SectionTitle>
              <CardList>
                {otherContracts.map((c) => (
                  <DappContractCard
                    key={c.id}
                    contract={c}
                    canFulfill={fulfillableSet.has(c.id)}
                    onDeliver={() => setDeliverTarget(c)}
                  />
                ))}
              </CardList>
            </>
          )}
        </>
      )}

      {deliverTarget && ssuId && (
        <DappDeliverModal
          contract={deliverTarget}
          ssuId={ssuId}
          inventory={userItems}
          onClose={() => setDeliverTarget(null)}
          onSuccess={() => refetch()}
        />
      )}
    </Page>
  );
}
