# Frontier Corm — Makefile
#
# Usage:
#   make local              Start local dev environment (docker compose)
#   make local-down         Stop local dev, keep data
#   make local-reset        Stop local dev + delete volumes
#
#   make infra-init         First-time CDK bootstrap (once per account/region)
#   make deploy-env ENV=utopia   Deploy all infra + services + frontend for an environment
#   make deploy-utopia      Shorthand for deploy-env ENV=utopia
#   make deploy-stillness   Shorthand for deploy-env ENV=stillness
#   make teardown ENV=utopia Destroy all AWS resources for an environment
#
#   make deploy-images      Build + push Docker images to ECR
#   make deploy-frontend    Build + sync frontend to S3 + invalidate cache
#   make deploy-infra       CDK deploy only (no image push)
#   make publish-contracts ENV=utopia  Publish Move contracts for an environment
#   make publish-utopia     Shorthand for publish-contracts ENV=utopia
#   make publish-stillness  Shorthand for publish-contracts ENV=stillness
#
#   make build              Build all TypeScript projects locally
#   make clean              Remove all build artifacts

.PHONY: local local-down local-reset \
        infra-init deploy-env deploy-infra deploy-images deploy-frontend teardown \
        deploy-utopia deploy-stillness \
        publish-contracts publish-utopia publish-stillness \
        build clean enrich-items seed-ores zk-build zk-clean help

SHELL := /bin/bash
AWS_REGION ?= us-east-1

# ENV selects the game-world environment: utopia (default) or stillness.
# Each environment gets its own CDK stack, contracts, and frontend build.
ENV ?= utopia

# Derive the CDK stack name from ENV (e.g. FrontierCormUtopia)
ENV_TITLE := $(shell echo '$(ENV)' | sed 's/./\U&/')
STACK_NAME := FrontierCorm$(ENV_TITLE)

# Resolve values from CDK outputs (cached after first deploy)
define get_output
$(shell aws cloudformation describe-stacks \
  --stack-name $(STACK_NAME) \
  --query "Stacks[0].Outputs[?OutputKey=='$(1)'].OutputValue" \
  --output text --region $(AWS_REGION) 2>/dev/null)
endef

# ── Local Development ──────────────────────────────────────────────

local: ## Start local dev environment
	@test -f .env || (echo "No .env file found. Run: cp .env.example .env" && exit 1)
	docker compose up -d --build
	@echo ""
	@echo "  Indexer API:  http://localhost:3100"
	@echo "  Postgres:     localhost:5432"
	@echo ""
	@echo "  Logs:   docker compose logs -f"
	@echo "  Stop:   make local-down"

local-down: ## Stop local dev (keep data)
	docker compose down

local-reset: ## Stop local dev + delete all data
	docker compose down -v

# ── Infrastructure ─────────────────────────────────────────────────

infra-init: ## First-time CDK + npm setup
	npm --prefix infra ci
	npx --prefix infra cdk bootstrap aws://$(shell aws sts get-caller-identity --query Account --output text)/$(AWS_REGION)

deploy-infra: ## Deploy CDK stack for ENV (infra only)
	npx --prefix infra cdk deploy $(STACK_NAME) --require-approval never -c appEnv=$(ENV) -c suiNetwork=testnet

# ── Docker Images ──────────────────────────────────────────────────

deploy-images: ## Build and push Docker images to ECR
	$(eval INDEXER_ECR := $(call get_output,IndexerEcrUri))
	$(eval CONTINUITY_ECR := $(call get_output,ContinuityEcrUri))
	$(eval AWS_ACCOUNT := $(shell aws sts get-caller-identity --query Account --output text))
	@echo "Logging in to ECR..."
	aws ecr get-login-password --region $(AWS_REGION) | \
		docker login --username AWS --password-stdin $(AWS_ACCOUNT).dkr.ecr.$(AWS_REGION).amazonaws.com
	@echo "Building and pushing indexer..."
	docker build -t $(INDEXER_ECR):latest ./indexer
	docker push $(INDEXER_ECR):latest
	@echo "Building and pushing continuity-engine..."
	docker build -t $(CONTINUITY_ECR):latest ./continuity-engine
	docker push $(CONTINUITY_ECR):latest
	@echo "Forcing ECS redeployment..."
	aws ecs update-service --cluster fc-$(ENV)-cluster --service $(STACK_NAME)-IndexerServiceE6A6AFC3-* \
		--force-new-deployment --region $(AWS_REGION) > /dev/null
	aws ecs update-service --cluster fc-$(ENV)-cluster --service $(STACK_NAME)-ContinuityService* \
		--force-new-deployment --region $(AWS_REGION) > /dev/null
	@echo "Done. ECS indexer and continuity-engine are redeploying."

# ── Frontend ───────────────────────────────────────────────────────

deploy-frontend: ## Build frontend for ENV and sync to S3 + invalidate CloudFront
	$(eval UI_BUCKET := $(call get_output,UiBucketName))
	$(eval CF_DIST := $(call get_output,CloudFrontDistributionId))
	@echo "Building frontend (mode=$(ENV))..."
	npm --prefix web run build -- --mode $(ENV)
	@echo "Syncing to s3://$(UI_BUCKET)..."
	aws s3 sync web/dist/ s3://$(UI_BUCKET) --delete --region $(AWS_REGION)
	@echo "Invalidating CloudFront cache..."
	aws cloudfront create-invalidation --distribution-id $(CF_DIST) --paths "/*" > /dev/null
	@echo "Frontend deployed ($(ENV))."

# ── Environment Deployment ─────────────────────────────────────────

publish-contracts: ## Publish Move contracts for ENV (utopia or stillness)
	bash scripts/publish-contracts.sh $(ENV)

publish-utopia: ## Publish Move contracts for Utopia
	$(MAKE) publish-contracts ENV=utopia

publish-stillness: ## Publish Move contracts for Stillness
	$(MAKE) publish-contracts ENV=stillness

deploy-env: ## Deploy everything for ENV (no seeding)
	@test -f .env.$(ENV) || (echo "No .env.$(ENV) found. Run: cp .env.$(ENV).example .env.$(ENV)" && exit 1)
	@echo "=== Deploying $(ENV) ==="
	$(MAKE) deploy-infra ENV=$(ENV)
	$(MAKE) deploy-images ENV=$(ENV)
	@set -a && . ./.env.$(ENV) && set +a && $(MAKE) deploy-frontend ENV=$(ENV)
	@echo ""
	@echo "=== $(ENV) Deployment Complete ==="
	@echo "  Frontend: $(call get_output,CloudFrontUrl)"
	@echo "  API:      http://$(call get_output,AlbDns)"
	@echo ""

deploy-utopia: ## Deploy everything for Utopia
	$(MAKE) deploy-env ENV=utopia

deploy-stillness: ## Deploy everything for Stillness
	$(MAKE) deploy-env ENV=stillness

teardown: ## Destroy all AWS resources for ENV
	@echo "This will destroy ALL Frontier Corm $(ENV) AWS resources (stack: $(STACK_NAME))."
	@read -p "Type 'yes' to confirm: " confirm && [ "$$confirm" = "yes" ] || exit 1
	npx --prefix infra cdk destroy $(STACK_NAME) --force -c appEnv=$(ENV)
	@echo "$(STACK_NAME) resources destroyed."

# ── Static Data ────────────────────────────────────────────────────

enrich-items: ## Enrich items.json with category/group/tier/tag data
	node scripts/enrich-items.mjs

# ── Seeding ────────────────────────────────────────────────────────

seed-ores: ## Seed ore items into SSU for Player A (requires world-contracts deployed)
	cd ../world-contracts && NODE_PATH=$$PWD/node_modules npx tsx $(CURDIR)/scripts/seed-ores.ts

# ── Build / Clean ──────────────────────────────────────────────────

build: ## Build all TypeScript projects locally
	npm --prefix indexer run build
	npm --prefix web run build
	npm --prefix infra run build

clean: ## Remove build artifacts
	rm -rf indexer/dist web/dist infra/dist infra/cdk.out

# ── ZK Circuits ────────────────────────────────────────────────────

zk-build: ## Build Groth16 artifacts for region/proximity location circuits
	bash indexer/scripts/build-zk-artifacts.sh

zk-clean: ## Remove generated ZK artifacts
	rm -rf indexer/circuits/build indexer/circuits/*.ptau
	rm -rf indexer/circuits/artifacts/*
	touch indexer/circuits/artifacts/.gitkeep

# ── Help ───────────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
