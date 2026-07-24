# WorkHub Microservices Migration Report

## Repository state
- Current branch: feat/optimization-and-security-fixes
- Current HEAD: caa2bea4405fbd507cc071d973e6c0eddd73fe24
- Working tree: Modified
- Last verified date: 2026-07-24

## Current phase
CURRENT_PHASE: M3
STATUS: IN_PROGRESS

## Phase status
| Phase | Status | Evidence | Blockers |
|---|---|---|---|
| S0 | VERIFIED | npm run check pass, build pass, audit:prod clean | None |
| S1 | VERIFIED | Dispute-Refund outbox, Push DNS allowlist, Rating calculation, freeCancelHours validation, custom tests pass | None |
| S2 | VERIFIED | Old platform/growth routers/controllers split into 7 domain-specific modules, mounted in app.js | None |
| M1 | VERIFIED | npm workspaces monorepo established; monolith relocated to apps/legacy-monolith; npm ci and all 59 test suites pass | None |
| M2 | VERIFIED | apps/api-gateway created with Express/http-proxy-middleware v3 pass-through proxy; request ID, rate limits, health checks, error formatting, gateway.test.js pass. Added WebSocket upgrade forwarding, graceful shutdown, automated contract comparison test (contract-comparison.test.js), and rollback smoke test (rollback-smoke.test.js). | None |
| M3 | IN_PROGRESS | Setting up RabbitMQ and Transactional Outbox/Inbox messaging foundation | None |
| M4 | NOT_STARTED | | |
| M5 | NOT_STARTED | | |
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

## Event catalog
- `catalog.review-created.v1`
- `catalog.rating-recalculated.v1`
- `booking.hold-created.v1`
- `booking.confirmed.v1`
- `billing.payment-succeeded.v1`
- `billing.refund-completed.v1`

## Compatibility shims
- None required yet.

## Rollback plan
- Emergency rollback to monolith routes at API Gateway level.

## Risks and technical debt
- Legacy controllers like `growthController.js` and `platformController.js` are God Controllers.

## Next actions
- Execute M3: Setting up RabbitMQ and Transactional Outbox/Inbox messaging foundation.
