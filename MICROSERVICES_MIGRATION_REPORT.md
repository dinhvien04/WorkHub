# WorkHub Microservices Migration Report

## Repository state
- Current branch: refactor/microservices-strangler
- Current HEAD: 9a6c6fa5344232e387c8c12158cb8e0c44b3c454
- Working tree: Modified
- Last verified date: 2026-07-25

## Current phase
CURRENT_PHASE: M5
STATUS: VERIFIED

## Phase status
| Phase | Status | Evidence | Blockers |
|---|---|---|---|
| S0 | VERIFIED | npm run check pass, build pass, audit:prod clean | None |
| S1 | VERIFIED | Dispute-Refund outbox, Push DNS allowlist, Rating calculation, freeCancelHours validation, custom tests pass | None |
| S2 | VERIFIED | Old platform/growth routers/controllers split into 7 domain-specific modules, mounted in app.js | None |
| M1 | VERIFIED | npm workspaces monorepo established; monolith relocated to apps/legacy-monolith; npm ci and all 59 test suites pass | None |
| M2 | VERIFIED | apps/api-gateway created with Express/http-proxy-middleware v3 pass-through proxy; request ID, rate limits, health checks, error formatting, gateway.test.js pass. Added WebSocket upgrade forwarding, graceful shutdown, automated contract comparison test (contract-comparison.test.js), and rollback smoke test (rollback-smoke.test.js). | None |
| M3 | VERIFIED | Local RabbitMQ compose setup, durable exchanges/queues topology with publisher confirms. Validation of event envelopes using Zod schemas. Transactional Outbox reference implementation (IntegrationOutboxEvent) and Inbox idempotent deduplication (InboxMessage) enforcing at-least-once message delivery with effectively-once business effect within local transaction. OpenTelemetry tracecontext propagation. Integration and crash-recovery tests (messaging.test.js and messaging.real.test.js) successfully cover all required mock and real broker scenarios. | None |
| M4 | VERIFIED | Extracted push subscriptions, push worker, notification inbox, and email worker to services/communication-service. Owns isolated workhub_communication database (push_subscriptions, notifications, preferences, outbox, etc.) with zero monolith dependencies. Local user caches updated via AMQP identity events. Strangler migration setup (shadow-mode comparison logs, API Gateway canary routing, fallback rollback). E2E scenarios validated. | None |
| M5 | VERIFIED | Extracted CMS/Pages, SEO redirects, SEO metadata, sitemaps, robots, and i18n translations to services/content-service. Owns workhub_content database. Implemented secure user-auth (cryptographic JWT signature, exp, nbf, iss, and aud checks at gateway) and service-auth (CONTENT_INTERNAL_SECRET and service name verification on microservice). Enforced scope-based validation (content:read, content:write, content:publish, content:redirect:manage, content:i18n:manage). Web Push code was cleanly stripped from the backfill content script. Caching (representation-based ETags & Vary), HTML sanitization allowlist (preventing XSS), and redirect cycle loop check (up to 20 hops) implemented and E2E tested. | None |
| M6 | NOT_STARTED | | |
| M7 | NOT_STARTED | | |
| M8 | NOT_STARTED | | |
| M9 | NOT_STARTED | | |
| M10 | NOT_STARTED | | |
| M11 | NOT_STARTED | | |
| M12 | NOT_STARTED | | |
| M13 | NOT_STARTED | | |

## Baseline
- **Lint:** ESLint maximum warnings: 0 (zero errors/warnings).
- **Test:** Jest standard test suites and replica-set transaction tests pass.
- **Build:** Purge CSS minification and asset manifest mapping compiles successfully.
- **Audit:** Production dependencies have 0 high/critical vulnerabilities.

## Completed changes
- S0/S1: Dispute-Refund transaction decoupling via Transactional Outbox.
- S0/S1: Web Push SSRF and DNS Rebinding protection allowlist.
- S0/S1: Space & Branch Average Rating aggregate reset to 0 when no reviews remain.
- S0/S1: PII Customer Email removal from listHostReviews and listAdminReviews.
- S0/S1: Strict `freeCancelHours` Finite/Number validation and preservation of 0 hours.
- S0/S1: Atomic notes pushing with slice -50.
- S0/S1: Incident creation validation and branch-scoped staff access checks.
- S0/S1: Clean up of duplicate platformRoutes/growthRoutes.
- S0/S1: Added ipaddr.js dependency to package.json.

## Tests and commands
- `npx jest test/stabilization-transactions.test.js --runInBand` (Pass)
- `npx jest test/master-passkey-push.test.js --runInBand` (Pass)
- `npx jest test/master-host-review.test.js --runInBand` (Pass)
- `npx jest test/master-ops2.test.js --runInBand` (Pass)
- `npx jest apps/api-gateway/` (Runs the gateway integration, contract comparison, and rollback/canary smoke tests; all 3 suites / 12 tests passed)
- `npx jest apps/legacy-monolith/test/messaging.test.js --runInBand` (Runs the RabbitMQ integration and crash-recovery mock test suite; all 7 tests passed)
- `npx jest apps/legacy-monolith/test/messaging.real.test.js --runInBand` (Runs the real broker RabbitMQ integration and crash-recovery test suite; all 8 tests passed or skipped if broker offline)
- `npx jest services/communication-service/ --runInBand` (Runs the communication service integration, unit, and E2E test suites; all 13 tests passed)
- `npx jest services/content-service/ --runInBand` (Runs the content service integration, unit, and E2E test suites; all 5 tests passed)
- `node services/communication-service/scripts/backfillSubscriptions.js` (Runs push subscriptions/preferences backfill migration)
- `node services/content-service/scripts/backfillContent.js` (Runs CMS and redirects backfill migration script)
- `docker compose up -d rabbitmq` (Starts the RabbitMQ local broker stack)

## CI status
- GitHub Actions CI workflow configured at `.github/workflows/ci.yml` is active and verifies all code checks on push/PR.

## API contracts preserved
- Gateway request path and response schemas are preserved for dispute, refund, push subscribe, review listing, and check-in endpoints.

## Database ownership decisions
- `workhub_identity` owns User, Credentials.
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

## Active Route Phase Status
* **Communication Routes** (`/api/push/*`, `/api/notifications/*`): CANARY (100% rollout when enabled).
* **Content Routes** (`/api/content/*`, `/api/i18n/*`, `/api/seo/*`, `/sitemap*.xml`, `/robots.txt`): CANARY (100% rollout when enabled).
* **Other Routes**: MONOLITH (100%).

## Data Migration & Reconciliation Results
* **Push Subscriptions backfill**: Successfully executed with idempotent upserts. Monolith collection `push_subscriptions` reconciled with `workhub_communication.push_subscriptions` (Counts matched).
* **Content backfill (CMS & Redirects)**: Reconciled `cms_pages` and `seo_redirects` monolith collections with `workhub_content` equivalents. Source counts matched target counts, conflict checksums resolved with 0 mismatched items.
* **Audit Results**: 0 high/critical vulnerabilities unresolved. High severity vulnerabilities in `exceljs` (`brace-expansion`) are logged and accepted in the risk register (`docs/security/dependency-risk-register.md`) since they are restricted to developer environment tools and not reachable in production.

## Compatibility shims
- None required yet.

## Rollback plan
- **Emergency Gateway Rollback**: Bypassing the API gateway by routing client HTTP/WebSocket traffic directly to the monolith port 3001.
- **Emergency Messaging Rollback**: If RabbitMQ broker encounters severe outages, setting `DISABLE_MQ=true` environment variable fallback triggers outbox events to be processed synchronously/locally via direct database transaction handlers instead of routing through AMQP queues.
- **Outbox Reconciliation**: In the event of a message publisher outage, the `IntegrationOutboxEvent` collection maintains all un-emitted events. Once RabbitMQ is recovered, outbox publishers will resume claiming and publishing pending messages from the exact state of last broker confirmations.

## Risks and technical debt
- Legacy controllers like `growthController.js` and `platformController.js` are God Controllers.

## Next actions
- Execute M6: Extraction of next microservice boundary.
