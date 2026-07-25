# ADR-001: Establish npm Workspaces Monorepo

## Context
WorkHub is transitioning from a monolith to a microservice-based architecture using the Strangler Fig pattern. To manage multiple services and shared packages within a single git repository while maintaining independent build/deploy pipelines, we need a repository organization model.

## Decision
We will establish an npm workspaces-based monorepo layout. 
The monolith will be relocated to `apps/legacy-monolith`.
Future microservices will be placed in `services/`.
Shared libraries will be located in `packages/`.
Dependencies will be managed at the root layer with a single `package-lock.json` file.

## Consequences
- Unified package management and dependency lock structure.
- Simplified codebase navigation during migration.
- Clean path mappings when extracting code chunks from legacy monolith to extracted services.
