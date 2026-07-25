# WorkHub Microservices Migration Report

## Repository state
- Current branch: main
- Current HEAD: pending-commit (will match after push of CI/M6 scaffold work)
- Working tree: active cleanup + M6 scaffold
- Last verified date: 2026-07-25

## Current phase
CURRENT_PHASE: M6
STATUS: IN_PROGRESS (scaffold + canary wiring)

## Phase status
| Phase | Status | Evidence | Blockers |
|---|---|---|---|
| S0 | VERIFIED | Baseline security/test gates green | None |
| S1 | VERIFIED | P0/P1 production safety fixes | None |
| S2 | VERIFIED | Domain route/controller split | None |
| M1 | VERIFIED | npm workspaces monorepo; apps/legacy-monolith | None |
| M2 | VERIFIED | apps/api-gateway pass-through + contract/rollback tests | None |
| M3 | VERIFIED | RabbitMQ foundation + outbox/inbox + messaging tests | None |
| M4 | VERIFIED | services/communication-service extraction | None |
| M5 | VERIFIED | services/content-service extraction | None |
| M5.1 | VERIFIED | Post-merge + post-push verification blockers closed | None |
| M6 | IN_PROGRESS | services/identity-service scaffolded; gateway canary route for `/api/auth` + `/api/sessions`; auth contract tests | Full auth surface (2FA/WebAuthn/Google/reset) still dual-run with monolith |
| M7 | NOT_STARTED | | |
| M8 | NOT_STARTED | | |
| M9 | NOT_STARTED | | |
| M10 | NOT_STARTED | | |
| M11 | NOT_STARTED | | |
| M12 | NOT_STARTED | | |
| M13 | NOT_STARTED | | |

## Baseline
- **Lint:** ESLint zero warnings on monorepo paths including identity-service.
- **Test:** API Gateway 29 tests green; Identity auth contract tests included.
- **Build:** CSS/assets build via legacy-monolith workspace.
- **Audit:** `npm run audit:prod` has 0 high/critical findings (2 moderate via exceljs/uuid accepted in risk register).
- **Docker:** `docker compose config` validates; local `docker compose build` requires Docker Desktop engine running.

## Active Route Phase Status
* **Communication Routes** (`/api/push/*`, `/api/notifications/*`): CANARY (env-controlled; default enabled in compose).
* **Content Routes** (`/api/content/*`, `/api/i18n/*`, `/api/seo/*`): CANARY (env-controlled).
* **Sitemap/Robots** (`/sitemap*.xml`, `/robots.txt`): **MONOLITH (Option B)** until full content SEO parity is complete.
* **Identity Routes** (`/api/auth/*`, `/api/sessions/*`): CANARY (default `IDENTITY_CANARY_PERCENT=0` / disabled until cutover).
* **Other Routes**: MONOLITH (100%).

## Database ownership decisions
- `workhub_identity` owns User, UserSession/Credentials (M6).
- `workhub_catalog` owns Space, Branch, Review.
- `workhub_booking` owns Booking, BookingSlot, Incident.
- `workhub_billing` owns PaymentHistory, Refund, RefundAllocation, LedgerEntry.
- `workhub_communication` owns PushSubscription, Notification.
- `workhub_content` owns ContentPage, SeoMetadata, SeoRedirect, Translation, PublicNavigation, PublicPolicy.

## Event catalog
- `catalog.review-created.v1`
- `catalog.rating-recalculated.v1`
- `catalog.review-replied.v1`
- `booking.hold-created.v1`
- `booking.confirmed.v1`
- `booking.cancelled.v1`
- `billing.payment-succeeded.v1`
- `billing.refund-completed.v1`
- `identity.user-created.v1`
- `identity.user-updated.v1`
- `content.page-published.v1`
- `content.page-unpublished.v1`
- `content.seo-redirect-updated.v1`
- `content.translation-updated.v1`

## M6 Identity extraction notes
- New workspace: `services/identity-service`
- Endpoints implemented in service:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
  - `GET /api/sessions`
  - `DELETE /api/sessions/:id`
  - `POST /api/sessions/logout-all`
- Gateway canary flags:
  - `IDENTITY_SERVICE_ENABLED`
  - `IDENTITY_CANARY_PERCENT`
  - `IDENTITY_SERVICE_URL`
  - `IDENTITY_INTERNAL_SECRET`
- Backfill script: `services/identity-service/scripts/backfillUsers.js` (idempotent upsert users/sessions).
- Default canary percent is **0** so production remains monolith-auth until intentionally enabled.

## Rollback plan
- Set `IDENTITY_SERVICE_ENABLED=false` or `IDENTITY_CANARY_PERCENT=0` to force auth back to monolith.
- Emergency gateway bypass still routes traffic directly to monolith port 3001.
- Messaging rollback remains `DISABLE_MQ=true` + outbox replay.

## Risks and technical debt
- Identity service currently covers core password auth/session contracts; 2FA/WebAuthn/Google/password-reset still live in monolith and require progressive dual-run extraction.
- Sitemap/robots remain on monolith (Option B).
- Docker Desktop engine may be offline on local Windows; CI docker job still validates compose build.
- Moderate `uuid` advisory via `exceljs` remains accepted in risk register.

## Next actions
1. Enable Identity dual-run canary in staging (`IDENTITY_CANARY_PERCENT` gradual rollout).
2. Extract remaining auth surface (2FA, WebAuthn, Google OIDC, email verify/reset) into identity-service.
3. Run production-like backfill + reconciliation of `users` / `user_sessions`.
4. Proceed to M7 Catalog Service only after Identity cutover criteria pass.
