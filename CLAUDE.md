# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

npm-workspaces monorepo mid-way through a strangler-fig extraction from a single
Express monolith. Paths in this file are repo-relative; almost all application
code lives under a workspace, not at the root.

| Workspace | Package | Role | Port |
|---|---|---|---|
| `apps/api-gateway` | `@workhub/api-gateway` | Edge proxy; verifies JWTs, canary-routes to services | 3000 |
| `apps/legacy-monolith` | `@workhub/legacy-monolith` | The original app; still owns most domains | 3001 |
| `services/communication-service` | `@workhub/communication-service` | Push, notifications, **all outbound email** | 3002 |
| `services/content-service` | `@workhub/content-service` | CMS, i18n, SEO redirects | 3003 |
| `services/identity-service` | `@workhub/identity-service` | Auth, sessions, MFA, passkeys | 3004 |
| `packages/contracts` | `@workhub/contracts` | Zod schemas for every integration event | — |
| `packages/observability` | `@workhub/observability` | OpenTelemetry + RabbitMQ helpers | — |
| `packages/test-utils` | `@workhub/test-utils` | Shared test helpers | — |

Migration state lives in `MICROSERVICES_MIGRATION_REPORT.md`; architectural
decisions in `docs/adr/`.

## Commands

Run from the repo root. Most scripts fan out across workspaces.

```bash
npm test                 # every workspace
npm run lint             # ESLint, zero warnings tolerated
npm run lint:security-ui # asserts no inline event handlers in critical JS
npm run build            # CSS purge + asset hashing (monolith)
npm run audit:prod       # npm audit, prod deps, high severity
```

Single workspace:

```bash
npm test --workspace=@workhub/identity-service
```

Single test file:

```bash
cd apps/legacy-monolith && npx jest test/auth.test.js --runInBand
```

`--runInBand` is required: suites share one in-memory MongoDB.

Monolith-only scripts (`cd apps/legacy-monolith` first):

```bash
npm run check            # lint:security-ui + check:contrast + lint + test
npm run check:contrast   # WCAG gate over the design tokens
npm run build:css        # runs the contrast gate, then purges and minifies
npm run reconcile:finance -- --dry-run
```

Identity-only:

```bash
npm run keys:generate    --workspace=@workhub/identity-service  # production secrets
npm run rotate:totp-keys --workspace=@workhub/identity-service  # re-encrypt TOTP seeds
npm run backfill:users   --workspace=@workhub/identity-service
```

## Architecture

### Process model

`apps/legacy-monolith/server.js` reads `PROCESS_ROLE` (`web` | `worker` | `all`):
**web** runs Express + Socket.IO, **worker** runs the periodic jobs. `app.js` is a
pure factory (`createApp()`) that never listens, so tests can import it.

### Request lifecycle (monolith)

1. `requestId` → `tracingMiddleware` → `requestTiming` → `apiVersion` → CSP nonce
2. `helmet` with a strict CSP — **script-src is `'self'` plus a per-request nonce**
3. Webhook carve-out: `POST /api/gateway/webhook` uses `express.raw` *before* the JSON
   parser so Stripe/MoMo signatures verify against the exact bytes
4. `optionalAuth` → `ensureCsrfCookie` → `maintenanceMode`
5. CSRF on every mutating `/api/` route except the explicit skip list in `app.js`
6. Routes → `notFoundHandler` → `errorHandler`

### Gateway

Holds **no database connection**. Identity state is reached only through JWKS
(local RS256 verification) and `POST /internal/auth/introspect`. Introspection
results live in a bounded LRU keyed by `SHA-256(token)` — never the raw JWT.
Canary routing is percentage-based per service via `*_SERVICE_ENABLED` and
`*_CANARY_PERCENT`.

Host registration is deliberately kept off identity-service until the M7
onboarding saga exists; the gateway parses the body of `POST /api/auth/register`
(the only endpoint it inspects) to route host signups to the monolith facade.

### Services layer (monolith)

Business logic lives in `services/`. Controllers validate, call a service, return.

- **`bookingService.js`** — the only place booking state transitions may happen;
  all changes go through `assertTransition()` against the `allowedTransitions` map
- **`outboxService.js`** — transactional outbox; side effects are enqueued in the
  same transaction as the write and dispatched by the job worker
- **`pricingService.js`** — server-side pricing; never trust a client-supplied price
- **`featureFlagService.js`** — percentage/role/env flags
- `gatewayService.js`, `ledgerService.js`, `payoutService.js`, `refundService.js`

### Identity service

Read `services/identity-service/README.md` before touching it. Load-bearing rules:

- **One key per purpose.** `JWT_SECRET`, `IDENTITY_PREAUTH_JWT_SECRET`,
  `IDENTITY_CSRF_SECRET`, `PASSWORD_RESET_PEPPER`, `IDENTITY_TOTP_ENCRYPTION_KEY`
  and `IDENTITY_OUTBOX_PAYLOAD_ENCRYPTION_KEY` are independent. Production boot
  fails if any is missing or equals `JWT_SECRET`.
- **Three token types, three validators** (`services/tokenService.js`): RS256
  access, legacy HS256 access, pre-auth 2FA. Each pins its own `alg`, `iss`,
  `aud` and `typ`. Never add a permissive `jwt.verify`.
- **All password checks go through `utils/password.js`.** Argon2id for new hashes,
  bcrypt still verifies and upgrades on login. A direct `bcrypt.compare` against a
  stored hash is a bug — that exact mistake once made disable-2FA impossible for
  every user.
- **Crypto fails closed.** An undecryptable TOTP seed raises; it is never treated
  as a successful verification.
- **Single-use credentials are spent with conditional updates**, so the loser of a
  race observes the loss. Never read-modify-write a token, OTP attempt counter or
  recovery code.
- **No email provider calls.** Identity enqueues `identity.email-requested.v1`;
  Communication Service owns delivery.

### Messaging

RabbitMQ via `@workhub/observability`. Producers write to a per-service outbox
table inside the business transaction; a worker claims rows with a lease,
publishes with confirms, retries with jittered backoff, and moves exhausted rows
to `dead` with a DLQ mirror. Consumers are idempotent through an inbox table
(`ProcessedMessage`).

Every event needs a Zod schema in `packages/contracts`; `validateEvent` runs on
both publish and consume.

### Background jobs

Worker process only (`apps/legacy-monolith/jobs/jobWorker.js`, claim-based
locking). Never run hold expiry or booking completion on the request path.

### Models

Mongoose models in each workspace's `models/`. Field names are PascalCase
(`TotalAmount`, `Status`, `SpaceID`) — match that when adding fields. Booking slot
locking relies on the unique compound index `{ SpaceID, SlotStart }`.

### Permissions

`policies/permissions.js` defines `owner`, `manager`, `receptionist`, `finance`,
`content_editor`, `support`. Always use
`assertHostPermission(hostOwnerId, userId, 'permission:name')`. Never write an
ad-hoc ownership check.

### Errors

Use the typed classes in `utils/errors.js` (`ValidationError`, `NotFoundError`,
`ConflictError`, `ForbiddenError`, `UnauthorizedError`). They carry `statusCode`
and `isOperational`, which is what stops internals leaking to clients.

## Frontend (monolith)

EJS under `views/` with `express-ejs-layouts` (`views/layout.ejs`). Page scripts
go through `res.locals.scriptsFrom([...])`, which injects the CSP nonce — a bare
`<script src>` pointing at an *external* host will be blocked in production.

### Styling

- `public/css/style.css` — design tokens and base
- `public/css/brand.css` — brand component layer (`wh-*`)
- `public/css/utilities.css` — utility classes
- `npm run build:css` concatenates all three into `public/css/app.min.css`

**Do not add a second stylesheet link to `layout.ejs`** — `app.min.css` already
contains the others.

Reference assets through `res.locals.asset('css/app.min.css')` so the
content-hashed `/dist` URL is used; that is what makes the immutable cache header
usable and what busts it on deploy.

### Accessibility is gated, not aspirational

`npm run check:contrast` asserts 42 colour pairs across light and dark themes and
runs inside `build:css`. Rules that follow from it:

- `--color-primary` is a 3:1 **UI accent**, not a text colour. Prose uses
  `--color-primary-text`; filled buttons with white labels use
  `--color-primary-fill`.
- Text never sits directly on a gradient — put it on a measured scrim.
- Animate only `transform` and `opacity`, so motion cannot cause layout shift.
  `prefers-reduced-motion` is honoured globally.
- Reserve boxes for late-arriving content (`aspect-ratio` on images,
  `min-height` on stat values) to keep CLS at zero.
- Every `<label>` needs a `for`; every `<img>` needs an `alt`; icon-only controls
  need an accessible name.
- Scroll-reveal hidden states are scoped to `html.js`, so a failed script request
  cannot blank the page.

## Testing

`mongodb-memory-server`, started in each workspace's test setup. `NODE_ENV=test`.
Tests **must not** disable CSRF globally — the security suites exercise it.
Rate limiters skip in tests unless `IDENTITY_ENABLE_RATE_LIMIT_IN_TEST=true`,
because limiter state is process-wide and leaks between suites.

Real-broker outbox tests run only when `IDENTITY_TEST_RABBITMQ=1` (CI sets it).

## Git workflow

Conventional Commits: `feat`, `fix`, `hotfix`, `refactor`, `docs`, `style`,
`chore`, `test`, `perf`. Imperative mood, ~50–72 char subject.
