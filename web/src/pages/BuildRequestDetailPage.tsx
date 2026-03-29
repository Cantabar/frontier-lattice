import { useParams, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useBuildRequestObject } from "../hooks/useBuildRequests";
import { BuildRequestDetail } from "../components/contracts/BuildRequestDetail";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { SecondaryButton } from "../components/shared/Button";

const Page = styled.div``;

const BackButton = styled(SecondaryButton)`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

export function BuildRequestDetailPage() {
  const { contractId } = useParams<{ contractId: string }>();
  const navigate = useNavigate();
  const { contract, isLoading, error } = useBuildRequestObject(contractId);

  if (isLoading) return <LoadingSpinner />;

  if (!contract) {
    return (
      <Page>
        <BackButton onClick={() => navigate("/contracts")}>← Back to list</BackButton>
        <EmptyState
          title="Build request not found"
          description={
            error
              ? `Error loading contract: ${error.message}`
              : `No build request found with ID ${contractId ?? "unknown"}`
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      <BackButton onClick={() => navigate("/contracts")}>← Back to list</BackButton>
      <BuildRequestDetail contract={contract} onStatusChange={() => navigate("/contracts")} />
    </Page>
  );
}
