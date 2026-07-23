# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev              # nodemon auto-reload
npm start                # production (PROCESS_ROLE=all)
npm run start:web        # HTTP + Socket.IO only
npm run start:worker     # background jobs only

# Testing
npm test                 # all tests (jest --runInBand, uses mongodb-memory-server)
npm run test:watch       # interactive watch mode
# Run a single test file:
npx jest test/auth.test.js --runInBand

# Linting & formatting
npm run lint             # ESLint (zero warnings)
npm run lint:security-ui # checks no inline event handlers in critical JS
npm run lint:fix         # auto-fix ESLint issues
npm run format:check     # Prettier check (subset of files)
npm run format           # Prettier write all

# Full pre-commit check
npm run check            # lint:security-ui + lint + test

# Build
npm run build:css        # purge unused utility classes → public/css/app.min.css
npm run build:assets     # hash/copy static assets → public/dist/

# Utilities
npm run seed:extras      # seed demo coupons + feature flags
npm run migrate:fields   # dry-run canonical field migration
npm run reconcile:finance -- --dry-run
npm run jobs:expire-holds
npm run sbom             # generate docs/sbom.json
npm run audit:prod       # npm audit (prod deps, high severity)
npm run smoke            # smoke E2E (requires running server)
```

## Architecture

### Process model

`server.js` reads `PROCESS_ROLE` (`web` | `worker` | `all`, default `all`) to decide what to start:
- **web**: Express HTTP + Socket.IO
- **worker**: four periodic jobs (complete expired bookings, hold reminders, job worker, booking reminders)

`app.js` is a pure factory (`createApp()`) that returns the Express app without listening — imported by both `server.js` and tests.

### Request lifecycle

Every request flows through:
1. `requestId` → `tracingMiddleware` → `requestTiming` → `apiVersion` → CSP nonce
2. `helmet` (strict CSP — scripts require per-request nonce; no `unsafe-inline` for scripts)
3. **Webhook carve-out**: `POST /api/gateway/webhook` uses `express.raw` before JSON parser to preserve the raw body for Stripe/MoMo signature verification
4. `optionalAuth` → `ensureCsrfCookie` → `maintenanceMode`
5. CSRF enforcement for all mutating API routes (except the explicit skip list in `app.js`)
6. Route handlers → `notFoundHandler` → `errorHandler`

### Route structure

| Mount | File | Scope |
|---|---|---|
| `/api/auth` | `routes/authRoutes.js` | Login, register, password reset, 2FA, WebAuthn, Google OIDC |
| `/api/customers` | `routes/customerApiRoutes.js` | All customer-facing API |
| `/api/me` | `routes/meExtraRoutes.js` | Extra `/me/` endpoints (favorites, coupons, notifications, privacy) |
| `/api/hosts` | `routes/hostRoutes.js` | Host management API |
| `/api/admin` | `routes/adminRoutes.js` | Admin API |
| `/api` | `routes/platformRoutes.js` | Public search, partner API, metrics, health extras |
| `/api` | `routes/growthRoutes.js` | Gateway webhook, checkout session |
| `/host/*` | page renders + `routes/paymentRoutes.js` | Host HTML pages |
| `/` | `routes/customerPageRoutes.js` | Customer HTML pages |
| (root) | `routes/seoRoutes.js` | Sitemap, robots, redirects — loaded before HTML pages |

### Services layer

Business logic lives exclusively in `services/`. Controllers are thin — they validate inputs, call services, and return responses. Key services:

- **`bookingService.js`** — the only place booking state transitions are allowed; enforces `allowedTransitions` map. All state changes go through `assertTransition()`.
- **`paymentService.js`** — payment records and idempotency key validation.
- **`gatewayService.js`** — payment gateway abstraction (mock / Stripe / MoMo); signature sign/verify via `gatewayProviders.js`.
- **`outboxService.js`** — transactional outbox pattern: side-effects (emails, notifications) enqueued atomically with DB writes, then dispatched by the job worker.
- **`ledgerService.js`** / **`payoutService.js`** / **`refundService.js`** — finance operations.
- **`featureFlagService.js`** — percentage/role/env-based feature flags; check flags before gating features.
- **`pricingService.js`** — server-side pricing rules applied to bookings (never trust client price).

### Background jobs

Jobs run in the worker process (`jobs/jobWorker.js` polls `BackgroundJob` documents via MongoDB claim-based locking for distributed safety):
- `completeExpiredBookings.js` — `in-use` + `EndTime < now` → `completed`
- `holdReminders.js` — remind customers about hold expiry
- `bookingReminders.js` — pre-booking reminders

Do **not** run hold expiry or booking completion on the request hot path — use the worker.

### Auth model

- JWT stored in `HttpOnly` cookie `authToken` (never localStorage).
- `tokenVersion` field on User invalidates all tokens after ban or password change.
- Per-session revoke: JWT carries `sid`; sessions stored as `SidHash` in `Session` collection.
- CSRF: double-submit cookie (`csrfToken` cookie + `X-CSRF-Token` header).
- Staff can act-as-host via `X-Host-Owner-Id` header through `/api/staff/*` proxy routes.

### Permissions (host staff)

`policies/permissions.js` defines roles: `owner`, `manager`, `receptionist`, `finance`, `content_editor`, `support`. Use `assertHostPermission(hostOwnerId, userId, 'permission:name')` — never roll your own ownership check.

### Models

All Mongoose models are in `models/`. Field names use PascalCase (e.g. `TotalAmount`, `Status`, `SpaceID`) — match the existing convention when adding fields.

Booking slot locking uses a unique compound index `{ SpaceID, SlotStart }` on `BookingSlot`. Slot times are floored to `BOOKING_SLOT_MINUTES` intervals.

### Errors

Use the typed error classes from `utils/errors.js` (`ValidationError`, `NotFoundError`, `ConflictError`, `ForbiddenError`, `UnauthorizedError`). These carry `statusCode` and `isOperational = true`; the central `errorHandler` renders them correctly.

### Frontend

Views are EJS templates under `views/` with `express-ejs-layouts` (layout: `views/layout.ejs`). Each page gets its JS via `res.locals.scriptsFrom([...])`, which injects `<script nonce="...">` tags. Public JS lives in `public/js/` — one file per page/feature.

CSS: production uses `public/css/app.min.css` (built by `npm run build:css`). In dev, Tailwind CDN is available when `USE_TAILWIND_CDN=1`.

### Testing

Tests use `mongodb-memory-server` (started in `test/helpers.js`). `test/setup.js` sets `NODE_ENV=test`, minimal JWT/MongoDB env vars, and disables transactions. Tests **must not** set `DISABLE_CSRF` globally — security tests exercise CSRF.

Run all tests with `--runInBand` (required — tests share a single in-memory MongoDB instance).

### Git workflow (from AGENTS.md)

Conventional Commits: `feat`, `fix`, `hotfix`, `refactor`, `docs`, `style`, `chore`, `test`, `perf`. Imperative mood, ≈50–72 char subject. Push to `main`.
