# Monolith Extraction Rollback Plan

This document describes the validation checks and emergency rollback procedures for microservices migrations.

## Safety Checklists

### 1. Pre-Deployment Validation (Monolith Boundaries Phase)
- Ensure all unit, integration, and E2E transaction test suites pass.
- Verify that standard lint checking, security linting, and dependency audits return 0 warnings/vulnerabilities.
- Build production CSS and assets and check for size regression or missing dependencies.

### 2. Emergency Cutover Rollback Steps
- In case a microservice deployment (e.g., Communication Service) fails:
  1. Re-route the corresponding API path (e.g., `/api/push/*`) at the API Gateway layer to point back to the `legacy-monolith` service.
  2. Restart monolith worker processes if disabled, enabling monolith processing.
  3. Revert database schema access permissions if they were locked down.
  4. Redeploy the previous stable version of the monolith.
- Keep backwards-compatible database fields intact (never drop database collections/fields until cutover is completely stable).

### 3. Content Service (M5) Rollback Procedure
If the Content Service experiences performance degradation, routing loop bugs, or database connection losses:
1. **API Gateway Action**: Set `CONTENT_SERVICE_ENABLED=false` and `CONTENT_CANARY_PERCENT=0` in the Gateway environment variables.
2. **Monolith Active Route verification**: Ensure the monolith routes `/huong-dan/:slug`, `/api/i18n`, `/api/seo`, sitemaps, and robots are fully active (they are not removed from the monolith app yet, so they serve requests immediately).
3. **Data Sync Recovery**: Execute `backfillContent.js` with the connection URIs reversed if needed to sync any updates created on `workhub_content` back to the monolith's collections (`cms_pages`, `seo_redirects`).
