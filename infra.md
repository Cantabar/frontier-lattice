# Frontier Lattice — Infrastructure

## Quick Reference

```
make local          # start local dev (docker compose)
make deploy         # deploy everything to AWS
make teardown       # destroy all AWS resources
make help           # list all targets
```

First-time setup: `./scripts/bootstrap.sh` then `make infra-init`

---

## Architecture

```
                     ┌─────────────┐
                     │  CloudFront │
                     │  (HTTPS)    │
                     └──────┬──────┘
                            │
               ┌────────────┴────────────┐
               │                         │
        S3: fl-ui-*              ALB (HTTP/80)
        (React SPA)              ┌───┴───────────────┐
                                 │                   │
                          /api/auth/*          /api/indexer/*
                          /api/optimizer/*
                          /api/privacy/*
                                 │                   │
                          ECS: api-service     ECS: indexer
                          (port 3000)          (port 3100)
                                 │                   │
                          Secrets Manager      SQLite (EFS vol)
                          S3: fl-encrypted-*   RDS Postgres (future)
```

---

## Decisions & Rationale

### Compute: ECS Fargate (not EC2, not Lambda)

- No cluster management overhead — Fargate is serverless containers.
- The indexer is a long-running WebSocket/polling subscriber; Lambda's 15-minute timeout rules it out.
- EC2 would be cheaper at scale but adds AMI management, patching, and capacity planning — wrong tradeoff for a 20-day hackathon.

### Database: RDS Postgres

- The CDK stack provisions `db.t4g.micro` RDS Postgres. The indexer connects via `DATABASE_URL`.
- The indexer uses the `pg` library (node-postgres) with a connection pool.
- Schema migrations run automatically on startup (`initDatabase()` applies `CREATE TABLE IF NOT EXISTS`).
- RDS was chosen over self-managed Postgres in a container because automated backups, patching, and failover are handled by AWS.

### Frontend: S3 + CloudFront (not ECS, not Amplify)

- The React UI (`web/`) is a Vite + React 18 + TypeScript SPA using styled-components and `@mysten/dapp-kit` for Sui wallet integration.
- S3 + CloudFront is the cheapest and fastest option for static hosting.
- CloudFront provides HTTPS with an ACM certificate and global edge caching.
- The SPA fallback (404 → `/index.html`) is configured in the CloudFront error responses.
- A multi-stage `web/Dockerfile` is also provided for containerized deployment (nginx + SPA fallback). Build-time `VITE_*` ARGs inject package IDs and network config.
- The UI connects to the indexer at `/api/v1` (proxied by Vite dev server in local dev, by CloudFront/ALB in production).

### Encrypted Storage: S3 (not DynamoDB, not a custom service)

- Confidential contract blobs are AES-encrypted client-side before upload.
- S3 provides SSE-S3 as an additional server-side encryption layer.
- 90-day lifecycle policy auto-expires stale blobs.
- Access is scoped via IAM task role — only the api-service ECS task can read/write.

### Secrets: AWS Secrets Manager (not Parameter Store, not env files)

- Secrets are injected into ECS task definitions as environment variables at runtime.
- Secrets Manager supports automatic rotation and fine-grained IAM access.
- Three secrets are provisioned:
  - `fl/db-credentials` — RDS username + auto-generated password
  - `fl/sui-rpc` — Sui RPC URL (update after deployment)
  - `fl/session-secret` — auto-generated 64-char key for JWT/session signing

### Networking: VPC with NAT Gateway

- ECS tasks and RDS run in private subnets (no public IPs).
- A single NAT Gateway provides outbound access for Sui RPC calls.
- **Cost note:** The NAT Gateway is the largest line item (~$10-15/20 days). If budget-constrained, move ECS tasks to public subnets with `assignPublicIp: true` and remove the NAT.

### Container Registry: ECR (not Docker Hub)

- Two repositories: `fl-indexer` and `fl-api-service`.
- Private registry scoped to the AWS account — no public exposure.
- `RemovalPolicy.DESTROY` + `emptyOnDelete: true` so `cdk destroy` cleans up completely.

### CI/CD: Makefile + manual (not GitHub Actions yet)

- For hackathon velocity, deployment is triggered manually via `make deploy`.
- The Makefile wraps: CDK deploy → Docker build/push to ECR → ECS force-redeploy → S3 sync → CloudFront invalidation.
- GitHub Actions can be added later by translating the Makefile targets into workflow steps.

---

## Services

| Service | Container | Port | ALB Path | Notes |
|---------|-----------|------|----------|-------|
| Indexer | `fl-indexer:latest` | 3100 | `/api/indexer/*` | Subscriber + query API, single process |
| API | `fl-api-service:latest` | 3000 | `/api/auth/*`, `/api/optimizer/*`, `/api/privacy/*` | Auth, optimizer, encrypted storage |

Both services run as 0.5 vCPU / 1 GB Fargate tasks with `desiredCount: 1`.

---

## Cost Estimate (~20 days)

| Resource | Estimated Cost |
|----------|---------------|
| ECS Fargate (2 tasks × 0.5 vCPU / 1 GB) | ~$10–15 |
| RDS db.t4g.micro | ~$5–8 |
| ALB | ~$5 |
| NAT Gateway | ~$10–15 |
| S3 + CloudFront | <$1 |
| Secrets Manager (3 secrets) | <$1 |
| ECR | <$1 |
| **Total** | **~$30–45** |

To reduce cost: remove NAT Gateway (use public subnets), or skip RDS until the SQLite migration is ready.

---

## File Layout

```
infra/
├── cdk.json                        # CDK project config
├── package.json                    # CDK dependencies
├── tsconfig.json                   # TypeScript config
├── bin/
│   └── app.ts                      # CDK app entry point
└── lib/
    └── frontier-lattice-stack.ts   # All AWS resources in one stack

app/
└── Dockerfile                      # API service container

web/
├── Dockerfile                      # Web UI container (nginx + SPA)
├── package.json                    # Vite, React 18, styled-components, dApp Kit
├── vite.config.ts                  # Dev server, /api proxy to indexer
└── src/
    ├── config.ts                   # VITE_* env var → package ID mapping
    ├── styles/                     # Theme (EVE Frontier palette), global styles
    ├── lib/                        # PTB builders, indexer client, types, format
    ├── hooks/                      # useIdentity, useTribe, useJobs, useOrders,
    │                               #   useReputation, useOptimizer
    ├── components/                 # tribe/, jobs/, forge/, events/, shared/
    └── pages/                      # Dashboard, TribePage, ContractBoard,
                                    #   ForgePlanner, EventExplorer

indexer/
└── Dockerfile                      # Indexer container

docker-compose.yml                  # Local dev: indexer + postgres
.env.example                        # Environment variable template
Makefile                            # Entry point for all operations
scripts/
└── bootstrap.sh                    # First-time dependency install + env setup
```

---

## Local Development

`docker-compose.yml` mirrors the production topology:

- **indexer** — builds from `indexer/Dockerfile`, exposes port 3100, uses SQLite with a Docker volume
- **postgres** — PostgreSQL 16 on port 5432, credentials `lattice/lattice`, for future services
- **app** — commented out, uncomment when `app/src/server.ts` exists
- **web** — run separately via `cd web && npm run dev` (Vite dev server on port 5173). Proxies `/api` requests to `localhost:3001` (indexer).

All services read from `.env` (copy from `.env.example`). The local Sui network runs separately via `sui start`.

### Web UI Environment Variables

The web UI reads Sui package IDs and network config from `VITE_*` env vars at build time:

```
VITE_SUI_NETWORK=localnet
VITE_TRIBE_PACKAGE_ID=0x...
VITE_CONTRACT_BOARD_PACKAGE_ID=0x...
VITE_FORGE_PLANNER_PACKAGE_ID=0x...
VITE_WORLD_PACKAGE_ID=0x...
VITE_COIN_TYPE=0x2::sui::SUI
VITE_INDEXER_URL=/api/v1
```

For local dev, defaults are used (all `0x0`). Update after `sui client publish`.

---

## Teardown

`make teardown` runs `cdk destroy --all --force` with a confirmation prompt. All resources have `RemovalPolicy.DESTROY` set:

- ECR repos are emptied then deleted
- S3 buckets are emptied then deleted
- RDS instance is deleted without final snapshot
- VPC, ALB, security groups, CloudFront distribution are all removed
- Secrets Manager secrets are deleted

Nothing persists after teardown.
