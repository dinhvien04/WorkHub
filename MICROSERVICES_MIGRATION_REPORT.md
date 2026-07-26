# WorkHub Microservices Migration Report

## Repository state
- Merged to main from: fix/m6-security-gate-finalization
- Branched from: 9ef1ac6 feat: implement identity rate limiting controls
- Working tree: clean
- Last verified date: 2026-07-26

## Current phase
CURRENT_PHASE: M6
STATUS: SECURITY GATE CLOSED (canary still at 0% pending staging rollout)

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
| M6 | VERIFIED | Durable outbox, per-purpose keyrings, CSRF, token-type separation, gateway DB removal; 70 identity + 58 gateway tests green | None blocking; canary rollout is an operational step |
| M7 | NOT_STARTED | | |
| M8 | NOT_STARTED | | |
| M9 | NOT_STARTED | | |
| M10 | NOT_STARTED | | |
| M11 | NOT_STARTED | | |
| M12 | NOT_STARTED | | |
| M13 | NOT_STARTED | | |

## Baseline (verified 2026-07-26)
- **Lint:** `npm run lint` and `npm run lint:security-ui` clean, zero warnings.
- **Test:** 449 passing, 2 skipped, 0 failing.
  - legacy-monolith 61 suites / 297 tests
  - identity-service 4 suites / 70 tests (+2 real-RabbitMQ tests skipped locally, enabled in CI via `IDENTITY_TEST_RABBITMQ=1`)
  - api-gateway 5 suites / 58 tests (includes the spawned-service E2E suite)
  - communication-service 3 suites / 14 tests
  - content-service 2 suites / 9 tests
- **Build:** `npm run build` green; `app.min.css` 28,637 bytes; asset manifest written.
- **Audit:** `npm run audit:prod` — 0 high/critical (2 moderate via exceljs→uuid, accepted in the risk register).
- **Docker:** `docker compose config` validates. `docker compose build` not run locally (Docker engine offline on this Windows host); CI's docker job covers it.

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

## M6 security gate (closed 2026-07-26)

See `docs/adr/ADR-009-identity-security-gate.md` for rationale. Summary:

| Area | Before | After |
|---|---|---|
| Outbox | Shim calling Resend inline; `session`/`idempotencyKey` discarded | `identity_outbox` written in-transaction; worker with lease, confirms, jittered backoff, max attempts, dead/DLQ |
| Email | Identity called the provider directly | Communication Service owns delivery via `identity.email-requested.v1` |
| Signing keys | Generated at boot when unset, no production guard | Fail-fast in production; kid lookup, previous-key overlap, retired-kid rejection, JWKS ETag |
| TOTP seeds | Key derived from `IDENTITY_INTERNAL_SECRET`; malformed ciphertext returned as plaintext | Dedicated versioned keyring, rotation script, fails closed |
| Pre-auth 2FA | Signed with `JWT_SECRET`, no `aud`/`typ`/`jti`, replayable 5 min | Own key, `workhub-preauth-2fa+jwt`, one-time row, atomic consume |
| Passwords | `bcrypt.compare` against Argon2id in disable-2FA — no user could disable 2FA | Single `verifyPassword` helper across all paths, lazy bcrypt→Argon2id upgrade |
| Password reset | Bare SHA-256 OTP, non-atomic attempts and consume | HMAC + `PASSWORD_RESET_PEPPER`, constant-time compare, atomic attempts, single-winner transaction |
| CSRF | Absent from identity-service entirely | Signed double-submit + Origin allowlist + Fetch Metadata; `/internal/*` exempt by design |
| Legacy HS256 | Accepted indefinitely | `IDENTITY_LEGACY_JWT_ENABLED` + `IDENTITY_LEGACY_JWT_DEADLINE`, enforced in both gateway and identity |
| Gateway | Own Mongoose connection; unbounded cache keyed by raw JWT | No DB at all; bounded LRU keyed by `SHA-256(token)` with TTL and revocation eviction |
| Host registration | Routed to identity, dropped verification document | Refused unless the internal onboarding saga calls; gateway keeps it on the facade |

Two dead references were also removed from `googleOidcService`: a
`require("./integrationOutboxService")` for a module that does not exist (Google
registration would have thrown `MODULE_NOT_FOUND`), and a `Customer_Profile`
model that belongs to the catalog domain.

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
- **Per-IP rate limits are still in-memory** (`express-rate-limit`), so budgets are per-instance rather than per-cluster. The reset-OTP attempt counter *is* atomic in Mongo and therefore correct across replicas; only the coarse IP limiters are affected. Redis-backed limiting is the remaining piece of fix.md item 5.
- Password reset keeps the six-digit OTP rather than a 32-byte token, to preserve the existing client contract. All requested hardening is in place.
- The gateway now depends on identity-service for **all** authenticated traffic, including legacy HS256. Mutations return 502 during an identity outage instead of proceeding unauthenticated — a deliberate correctness-over-availability trade that raises identity's availability requirement.
- Production now needs ~8 additional secrets; the service fail-fasts naming the missing variable. `npm run keys:generate -w @workhub/identity-service` emits a full set.
- Sitemap/robots remain on monolith (Option B).
- Docker engine offline on this Windows host; `docker compose build` verified only by CI.
- Moderate `uuid` advisory via `exceljs` remains accepted in the risk register.

## Next actions
1. Provision the new identity secrets in staging, then enable the dual-run canary (`IDENTITY_CANARY_PERCENT` gradual rollout).
2. Run production-like backfill + reconciliation of `users` / `user_sessions`.
3. Set `IDENTITY_LEGACY_JWT_DEADLINE` once the canary reaches 100%, then remove the HS256 path from both services.
4. Move per-IP rate limiting to Redis.
5. Proceed to M7 Catalog Service only after Identity cutover criteria pass — host registration stays on the facade until that saga exists.
