# M1 Monorepo Migration Plan

This document describes the npm workspaces transition from a single package monolith layout to a monorepo containing the legacy monolith along with future packages and services.

## Monorepo Layout Structure
```
WorkHub/
├─ apps/
│  └─ legacy-monolith/       (Legacy Monolith app)
├─ services/                  (Future extracted microservices)
├─ packages/                  (Shared contract libraries)
├─ package.json               (Root package.json with workspaces configurations)
└─ package-lock.json          (Root unified lock file)
```

## Migration Execution Checklist
1. **Initial Workspace Setup:**
   * Create the root workspace directories: `apps/`, `services/`, `packages/`.
   * Configure `"workspaces"` inside the root `package.json` file.
2. **Legacy Monolith Relocation:**
   * Move the monolith source files, assets, public directory, views, controllers, and database models into `apps/legacy-monolith/`.
   * Keep configuration templates, scripts, and dev tools updated to reflect the new nested workspace location.
3. **Dependency Mapping:**
   * Consolidate dependencies between root and legacy monolith workspace packages.
   * Ensure that standard commands (`npm start`, `npm run dev`, `npm test`, `npm run build`) can be run seamlessly from the root directory.
