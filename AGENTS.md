Commit with semantic commit messages
Hosting preferences: 
 Cloud provider: AWS
 Front-End static files: AWS S3
 Back-End Servers: docker containers with Fargate
Resources:
 Developer docs for Eve Frontier: https://docs.evefrontier.com
 Eve Frontier World Contracts: https://github.com/evefrontier/world-contracts
 Caution! Other resources may contain references to EVM. Eve Frontier is migrating from EVM to SUI.
Plans
 Preface all plan names created in this project with [frontier-corm][service-name]
 Planning should always reference the design doc for each service.
 Plans should always include a step to update the design doc for each service. The design doc should live at the root of the service. For example, the puzzle service should have a design doc at ./puzzle-service/design-doc.md
 Plans on ./contracts should strongly prefer upgrades over full publishes. Notify the user when a publish is absolutely required to accomplish the plan.
Documentation
 each service should have a design doc that explains what the service does
 the design-doc should contain a list of features that exist in the service
Testing
 Run all tests: `make test` from the repo root
 Run Go tests only: `make test-go` (continuity-engine)
 Run Move tests only: `make test-contracts` (all contract packages)
 Services with tests: continuity-engine (Go), contracts (Sui Move), dev-tools (Sui Move PoC)
 Services without tests: indexer, web, infra, static-data, training-data
 Each service's design-doc.md contains a Testing section describing test layout and coverage
