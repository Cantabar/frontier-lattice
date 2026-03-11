# Frontier Lattice — Makefile
#
# Usage:
#   make local            Start local dev environment (docker compose)
#   make local-down       Stop local dev, keep data
#   make local-reset      Stop local dev + delete volumes
#
#   make infra-init       First-time CDK bootstrap (once per account/region)
#   make deploy           Deploy all infrastructure + services + frontend
#   make teardown         Destroy all AWS resources
#
#   make deploy-images    Build + push Docker images to ECR
#   make deploy-frontend  Build + sync frontend to S3 + invalidate cache
#   make deploy-infra     CDK deploy only (no image push)
#
#   make build            Build all TypeScript projects locally
#   make clean            Remove all build artifacts

.PHONY: local local-down local-reset \
        infra-init deploy deploy-infra deploy-images deploy-frontend teardown \
        build clean help

SHELL := /bin/bash
AWS_REGION ?= us-east-1
STACK_NAME := FrontierLattice

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

deploy-infra: ## Deploy CDK stack (infra only)
	npx --prefix infra cdk deploy --all --require-approval never

# ── Docker Images ──────────────────────────────────────────────────

deploy-images: ## Build and push Docker images to ECR
	$(eval INDEXER_ECR := $(call get_output,IndexerEcrUri))
	$(eval API_ECR := $(call get_output,ApiEcrUri))
	$(eval AWS_ACCOUNT := $(shell aws sts get-caller-identity --query Account --output text))
	@echo "Logging in to ECR..."
	aws ecr get-login-password --region $(AWS_REGION) | \
		docker login --username AWS --password-stdin $(AWS_ACCOUNT).dkr.ecr.$(AWS_REGION).amazonaws.com
	@echo "Building and pushing indexer..."
	docker build -t $(INDEXER_ECR):latest ./indexer
	docker push $(INDEXER_ECR):latest
	@echo "Building and pushing api-service..."
	docker build -t $(API_ECR):latest ./app
	docker push $(API_ECR):latest
	@echo "Forcing ECS redeployment..."
	aws ecs update-service --cluster fl-cluster --service $(STACK_NAME)-IndexerServiceE6A6AFC3-* \
		--force-new-deployment --region $(AWS_REGION) > /dev/null
	aws ecs update-service --cluster fl-cluster --service $(STACK_NAME)-ApiServiceD4217802-* \
		--force-new-deployment --region $(AWS_REGION) > /dev/null
	@echo "Done. ECS services are redeploying."

# ── Frontend ───────────────────────────────────────────────────────

deploy-frontend: ## Build frontend and sync to S3 + invalidate CloudFront
	$(eval UI_BUCKET := $(call get_output,UiBucketName))
	$(eval CF_DIST := $(call get_output,CloudFrontDistributionId))
	@echo "Building frontend..."
	npm --prefix app run build
	@echo "Syncing to s3://$(UI_BUCKET)..."
	aws s3 sync app/dist/ s3://$(UI_BUCKET) --delete --region $(AWS_REGION)
	@echo "Invalidating CloudFront cache..."
	aws cloudfront create-invalidation --distribution-id $(CF_DIST) --paths "/*" > /dev/null
	@echo "Frontend deployed."

# ── Full Deploy / Teardown ─────────────────────────────────────────

deploy: deploy-infra deploy-images deploy-frontend ## Deploy everything
	@echo ""
	@echo "=== Deployment Complete ==="
	@echo "  Frontend: $(call get_output,CloudFrontUrl)"
	@echo "  API:      http://$(call get_output,AlbDns)"
	@echo ""

teardown: ## Destroy all AWS resources
	@echo "This will destroy ALL Frontier Lattice AWS resources."
	@read -p "Type 'yes' to confirm: " confirm && [ "$$confirm" = "yes" ] || exit 1
	npx --prefix infra cdk destroy --all --force
	@echo "All resources destroyed."

# ── Build / Clean ──────────────────────────────────────────────────

build: ## Build all TypeScript projects locally
	npm --prefix indexer run build
	npm --prefix app run build
	npm --prefix infra run build

clean: ## Remove build artifacts
	rm -rf indexer/dist app/dist infra/dist infra/cdk.out

# ── Help ───────────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
