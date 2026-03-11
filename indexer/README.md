# Indexer — Phase 4 (Days 18–25)

Off-chain indexer that subscribes to Sui event streams and maintains a
queryable read model for the frontend.

## Planned components

- `src/indexer.ts` — Sui event subscription + PostgreSQL writer
- Indexed events: `TribeCreatedEvent`, `MemberJoinedEvent`, `ReputationUpdatedEvent`,
  `TreasurySpendEvent`, `JobPostingCreatedEvent`, `JobCompletedEvent`
- REST / GraphQL API serving tribe leaderboards and job feeds

## TODO: implement in Phase 4
