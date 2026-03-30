# Infra

## Overview

The infra directory contains the AWS CDK stack that provisions all cloud infrastructure for Frontier Corm. A single parameterized stack supports multiple game-world environments (utopia, stillness), each with isolated resources sharing the same architecture.

## Architecture

```
Internet
    │
    ▼
Route 53 (ef-corm.com)
    ├─ {env}.ef-corm.com ──► CloudFront ──► S3 (static frontend)
    │   (stillness = apex ef-corm.com)
    │
    └─ api.{env}.ef-corm.com ──► ALB (HTTPS :443)
                                    │
                                    ▼
                              ECS Fargate Cluster
                                ├─ Indexer Service (port 3100)
                                └─ Continuity Engine Service (port 3300)
                                    │
                                    ▼
                              RDS Postgres 16 (private subnet)
                                    │
                              Secrets Manager
                                ├─ fc-{env}/db-credentials
                                ├─ fc-{env}/sui-rpc
                                └─ fc-{env}/sui-signer

ACM Certificate: ef-corm.com + *.ef-corm.com (DNS-validated via Route 53)
```

### Domain Strategy

- **Root domain:** `ef-corm.com` (purchased in AWS Route 53)
- **Stillness (production):** apex `ef-corm.com` + `api.ef-corm.com`
- **Other environments:** `{env}.ef-corm.com` + `api.{env}.ef-corm.com` (e.g. `utopia.ef-corm.com`)
- **ACM certificate:** covers `ef-corm.com` + `*.ef-corm.com`, DNS-validated via Route 53

### Resource Naming

All resources are prefixed with `fc-{env}` (e.g. `fc-utopia`, `fc-stillness`). CDK stack names follow `FrontierCorm{Env}` (e.g. `FrontierCormUtopia`).

### Network Layout

- **VPC** — 2 AZs, 1 NAT gateway (cost optimization)
  - Public subnets (`/24`) — ALB
  - Private subnets (`/24`, with egress) — ECS tasks, RDS
- **Security Groups:**
  - ALB SG — inbound 80/443 from anywhere
  - ECS SG — inbound all TCP from ALB SG
  - DB SG — inbound 5432 from ECS SG only

## Tech Stack

- **IaC:** AWS CDK (TypeScript)
- **Compute:** ECS Fargate (512 CPU / 1024 MB per task)
- **Database:** RDS Postgres 16 (t4g.micro, gp3 20GB, single-AZ)
- **Storage:** S3 (frontend static assets, block public access)
- **CDN:** CloudFront (SPA routing via 404 → /index.html, custom domain + ACM cert)
- **DNS:** Route 53 (A alias records for CloudFront + ALB)
- **TLS:** ACM (ef-corm.com + *.ef-corm.com, DNS validation)
- **Registry:** ECR (`fc-{env}-indexer`, `fc-{env}-continuity-engine`)
- **Secrets:** Secrets Manager (DB credentials with auto-generated password, Sui RPC config, Sui signer keypair)
- **Logging:** CloudWatch Logs (`/ecs/fc-{env}`, 2-week retention)

## Configuration

### CDK Context Parameters

- `appEnv` — environment name: `utopia` (default) or `stillness`
- `suiNetwork` — Sui network: `testnet` (default) or `mainnet`
- `cormStatePackageId` — deployed corm_state Sui package ID (default empty; when set, disables `SEED_CHAIN_DATA`)

### Makefile Targets

- `make infra-init` — first-time CDK bootstrap + npm install
- `make deploy-infra ENV=utopia` — deploy CDK stack only
- `make deploy-images ENV=utopia` — build + push Docker images to ECR + force ECS redeployment
- `make deploy-frontend ENV=utopia` — build frontend + S3 sync + CloudFront invalidation
- `make deploy-env ENV=utopia` — deploy everything (infra + images + frontend)
- `make teardown ENV=utopia` — destroy all AWS resources for an environment

### Stack Outputs

- `IndexerEcrUri` — ECR repository URI for the indexer image
- `ContinuityEcrUri` — ECR repository URI for the continuity-engine image
- `UiBucketName` — S3 bucket name for frontend assets
- `CloudFrontDistributionId` — CloudFront distribution ID (for cache invalidation)
- `AlbDns` — API load balancer DNS name
- `DbEndpoint` — RDS Postgres endpoint address
- `SiteUrl` — public frontend URL (e.g. `https://ef-corm.com` or `https://utopia.ef-corm.com`)
- `ApiUrl` — public API URL (e.g. `https://api.ef-corm.com` or `https://api.utopia.ef-corm.com`)

## Data Model

No application data — this service provisions infrastructure only. Database schema is managed by the indexer and continuity-engine services at startup.

## Deployment

- **Prerequisites:** AWS CLI configured, CDK bootstrapped (`make infra-init`)
- **Per-environment:** `make deploy-env ENV=utopia` (or `make deploy-utopia` shorthand)
- **Teardown:** `make teardown ENV=utopia` (interactive confirmation required)
- **Region:** `us-east-1` (configurable via `AWS_REGION`)

## Features

- Single parameterized CDK stack supporting multiple game-world environments (utopia, stillness)
- VPC with 2-AZ layout, NAT gateway, public/private subnet isolation
- ECS Fargate with 512 CPU / 1024 MB per task (indexer + continuity-engine)
- RDS Postgres 16 (t4g.micro, gp3 20GB, single-AZ)
- S3 static frontend with CloudFront CDN and SPA routing
- Custom domain (ef-corm.com) with Route 53 DNS + ACM TLS certificate
- HTTPS on both CloudFront and ALB; HTTP redirects to HTTPS
- ALB sticky sessions on continuity-engine target group (1-day TTL) — required because the service uses an in-memory session store
- ECR container registry per service per environment
- Secrets Manager for DB credentials and Sui RPC config
- CloudWatch Logs with 2-week retention
- Makefile-driven deployment: infra, images, frontend, teardown
- CDK stack outputs for ECR URI, S3 bucket, CloudFront URL, ALB DNS

## Open Questions / Future Work

- Auto-scaling policies for ECS services
- Multi-AZ RDS for production reliability
- WAF integration for CloudFront/ALB
- Cost optimization: review NAT gateway usage, consider VPC endpoints
