# WorkHub — Production Security & Correctness Fix Prompt

> Repository: `https://github.com/dinhvien04/WorkHub`  
> Target: current `main` / latest HEAD at the time this prompt is executed  
> Primary runtime: Node.js 20+, Express 5, EJS, MongoDB/Mongoose  
> Intended coding agent: Grok 4.5 or another repository-capable coding agent

---

## 1. Role

You are the lead security engineer and senior backend engineer responsible for making WorkHub safe and correct enough for a real production deployment.

Work directly on the repository. Do not merely describe fixes. Inspect the current HEAD, implement the changes, update tests, run all verification commands, and produce a final implementation report.

The current repository contains many valuable features, but several authentication, authorization, booking, payment, refund, payout, staff-scope, frontend CSP, SEO, build, and CI flows are still prototype-grade or contain production blockers.

Your job is to fix them without removing legitimate product functionality unless a feature cannot be made safe during this task. Unsafe features must be disabled by default and fail closed.

---

## 2. Mandatory operating rules

1. Start by reading the current repository; do not assume file contents from this prompt are still identical.
2. Before editing, record:
   - current branch;
   - current HEAD SHA;
   - `git status`;
   - Node and npm versions.
3. Search for all duplicate routes and duplicate implementations before patching.
4. Do not trust client-provided:
   - user IDs;
   - host IDs;
   - roles;
   - payment amounts;
   - payment provider names;
   - scopes;
   - booking ownership;
   - file paths;
   - redirect destinations;
   - branch permissions.
5. Every object lookup must enforce authorization in the database query whenever possible.
6. All money operations must be idempotent and atomic.
7. Never keep a security bypass for test convenience.
8. Never make production silently fall back to a mock implementation.
9. Do not suppress build, lint, test, or audit failures with `|| true`, blanket `catch {}`, or forced process exit.
10. Do not change tests to bless insecure behavior.
11. Preserve backwards compatibility only when it does not preserve a vulnerability.
12. Add database migrations or repair scripts for schema/index changes.
13. Do not commit secrets, test credentials, private keys, OTPs, raw tokens, passkey private data, or bank data.
14. Run formatting, linting, unit tests, integration tests, build checks, and security checks before declaring completion.
15. If MongoDB transactions are required, support replica-set production and deterministic standalone test behavior explicitly.
16. Any unfinished feature must be hidden behind a server-side feature flag disabled by default.
17. Return generic public errors while retaining structured internal logs with request ID.
18. Do not expose stack traces, internal paths, secrets, provider payloads, or operational topology to public clients.

---

## 3. Required implementation sequence

Implement in this order:

1. Add regression tests that demonstrate each P0 vulnerability.
2. Disable unsafe production entry points immediately.
3. Fix authentication and external identity.
4. Fix payment gateway and webhook invariants.
5. Fix partner API authorization.
6. Fix refund, ledger, and payout accounting.
7. Fix booking, slot, coupon, add-on, recurring, and staff-scope correctness.
8. Fix frontend CSP/DOM safety and asset deployment.
9. Fix SEO, health endpoints, background jobs, and performance issues.
10. Expand CI so the repaired behavior cannot regress.

Do not work on visual polish until every P0 test passes.

---

# 4. P0 — Authentication blockers

## P0.1 Disable the insecure WebAuthn/passkey stub immediately

### Current risk

The repository contains a passkey flow that can accept a credential ID and challenge without mandatory cryptographic assertion verification. Optional verification, optional signatures, `skipped` verification, or tests using values such as `"stub"` are authentication bypasses.

### Immediate containment

Until the complete implementation below is working:

- make all passkey endpoints return `503 FEATURE_DISABLED` in production;
- keep the feature disabled by default in every environment except explicit integration tests;
- do not expose passkey UI when disabled;
- remove any production route that can authenticate from a credential ID alone.

Required flag:

```env
WEBAUTHN_ENABLED=false
```

Production startup must reject unsafe combinations such as:

```env
WEBAUTHN_ENABLED=true
WEBAUTHN_STRICT=false
```

There must be no `WEBAUTHN_REQUIRE_SIGNATURE` or `WEBAUTHN_REQUIRE_PUBLIC_KEY` opt-in security switch. Signature and public-key verification are always mandatory when WebAuthn is enabled.

### Required complete implementation

Use a maintained standards-aware library such as `@simplewebauthn/server`; do not hand-roll COSE, authenticator data, origin, RP ID, or signature verification.

Registration must:

1. Generate a cryptographically random challenge server-side.
2. Store only a hash or protected challenge record with:
   - purpose;
   - user ID;
   - expected RP ID;
   - expected origin;
   - expiry;
   - consumed state.
3. Verify:
   - challenge;
   - `clientDataJSON.type === "webauthn.create"`;
   - expected origin;
   - expected RP ID;
   - attestation response;
   - user presence;
   - user verification according to policy.
4. Store:
   - credential ID;
   - credential public key;
   - counter;
   - transports;
   - device metadata;
   - backup eligibility/state where supported.
5. Consume challenge atomically and once only.

Authentication must:

1. Generate a new login challenge.
2. Bind discoverable or email-based login to the correct account safely.
3. Verify:
   - challenge;
   - `clientDataJSON.type === "webauthn.get"`;
   - origin;
   - RP ID hash;
   - signature against the stored public key;
   - user presence;
   - user verification;
   - credential ownership;
   - challenge expiry and one-time use.
4. Update the authenticator counter with an atomic compare/update policy.
5. Reject:
   - missing signature;
   - invalid signature;
   - wrong origin;
   - wrong RP ID;
   - wrong challenge;
   - reused challenge;
   - credential belonging to another account;
   - disabled/banned/inactive user;
   - counter rollback according to the documented risk policy.
6. Issue the normal login session only after successful verification.

Never log registration options, authentication responses, credential public keys, challenges, signatures, or recovery material.

### Mandatory WebAuthn tests

Add integration tests for:

- valid registration and login;
- missing signature → rejected;
- arbitrary `"stub"` signature → rejected;
- wrong challenge → rejected;
- reused challenge → rejected;
- expired challenge → rejected;
- wrong origin → rejected;
- wrong RP ID → rejected;
- credential owner mismatch → rejected;
- disabled user → rejected;
- banned user → rejected;
- deleted credential → rejected;
- counter rollback behavior;
- feature disabled → routes and UI unavailable;
- production cannot start with unsafe WebAuthn configuration.

Reference: W3C WebAuthn Level 3  
`https://www.w3.org/TR/webauthn-3/`

---

## P0.2 Replace hand-decoded Google ID tokens with verified OIDC tokens

### Current risk

Base64-decoding an `id_token` is not verification. A production login must verify the Google signature and token claims.

### Required implementation

Use `google-auth-library` or a standards-compliant OIDC client.

Verify at least:

- cryptographic signature using Google keys;
- `aud` equals an allowlisted Google client ID;
- `iss` is Google;
- `exp` has not passed;
- `iat` is reasonable;
- nonce matches the authorization request;
- state matches and is consumed once;
- email requirements;
- `email_verified` where required.

Use `sub` as the stable Google account identifier. Do not use email as the federated identity primary key.

State and nonce must:

- be bound to the browser/session;
- expire;
- be one-time use;
- work across multiple application instances;
- not be held only in an in-memory `Map`.

Store them in a signed/encrypted HttpOnly cookie or a shared durable/Redis store.

### Account-linking safety

Do not silently link a Google identity to an existing local account by matching only email unless the user proves ownership of the existing account through a logged-in linking flow or re-authentication.

Required behavior:

- returning Google user with known `GoogleSub` → login;
- new Google identity → create customer account after validated token;
- email collision with an existing local account but no linked `GoogleSub` → require explicit secure account linking;
- banned/inactive account → reject;
- host/admin account linking requires elevated re-authentication and audit.

### Mandatory Google tests

- forged unsigned token → rejected;
- token signed for another audience → rejected;
- expired token → rejected;
- wrong issuer → rejected;
- wrong/reused state → rejected;
- wrong nonce → rejected;
- email collision cannot silently take over local account;
- banned linked user → rejected;
- valid verified token → login;
- multiple app instances can consume shared state correctly.

Reference: Google server-side ID token verification  
`https://developers.google.com/identity/gsi/web/guides/verify-google-id-token`

---

## P0.3 Make email verification real

### Required changes

Local customer registration must create:

```js
Status: 'inactive'
EmailVerified: false
EmailVerifiedAt: null
```

A local account must not receive a normal authenticated session until email verification succeeds.

Email verification token requirements:

- random high-entropy token;
- store only SHA-256 or stronger hash;
- expiry;
- one-time use;
- invalidate older active tokens;
- rate limit resend;
- generic public response;
- no token logging;
- production never returns a development token;
- atomic consume and user activation.

After successful verification:

```js
Status: 'active'
EmailVerified: true
EmailVerifiedAt: now
tokenVersion += 1 // when appropriate
```

Existing migrated accounts require a migration policy. Do not accidentally lock all existing verified users.

Tests:

- new local customer cannot login before verification;
- expired token rejected;
- reused token rejected;
- resend invalidates old token;
- successful verification activates account;
- no token in production response/log;
- Google verified accounts follow the separate verified OIDC policy.

---

# 5. P0 — Gateway and payment blockers

## P0.4 Remove mock payment completion from production

The endpoint that marks a mock gateway session complete must not exist in production.

Required behavior:

```js
if (!env.isDevelopment && !env.isTest) {
  // route is not mounted
}
```

Do not merely hide the button. The HTTP route itself must not be registered.

Mock providers must also be disabled in production:

```env
ALLOW_MOCK_PAYMENT_PROVIDER=false
```

Production startup must fail if:

- configured provider is mock;
- a live provider is missing required credentials;
- mock completion is enabled;
- webhook secret falls back to `JWT_SECRET`.

Add tests proving:

- production route returns 404 because it is not mounted;
- production cannot choose a mock provider through request input;
- production does not auto-downgrade Stripe/MoMo to mock;
- development mock flow still works only under explicit test/dev configuration.

---

## P0.5 Payment provider and amount are server-controlled

The client must not choose an arbitrary provider or amount.

Replace a payload such as:

```json
{
  "bookingId": "...",
  "amount": 100000,
  "provider": "workhub_mock"
}
```

with:

```json
{
  "bookingId": "...",
  "paymentType": "deposit"
}
```

Allowed payment types:

- `deposit`;
- `remaining_balance`;
- `full_payment`, only when nothing has been paid or according to an explicit policy.

Server calculation:

```text
successfulPaid = sum(successful payments) - valid allocated refunds
remaining = max(0, TotalAmount - successfulPaid)
```

The gateway amount must be derived from the booking snapshot and successful payment state.

Reject:

- amount <= 0;
- booking not owned by the customer;
- cancelled/rejected/expired/completed booking according to policy;
- remaining amount = 0;
- request that would create overpayment;
- duplicate active gateway session for the same logical payment stage;
- provider from the request when production provider is server-configured.

Use a composite idempotency scope that includes owner/booking/operation, not a globally reusable unscoped key.

---

## P0.6 Verify provider webhooks using the exact raw body

Mount webhook routes before `express.json()`.

Example structure:

```js
app.post(
  '/api/gateway/webhook/stripe',
  express.raw({ type: 'application/json', limit: '1mb' }),
  stripeWebhookHandler
);

app.use(express.json({ limit: '1mb' }));
```

Do not reconstruct raw bodies with `JSON.stringify(req.body)`.

Provider-specific requirements:

### Stripe

Use the official Stripe library and `stripe.webhooks.constructEvent()` with:

- exact raw bytes;
- `Stripe-Signature`;
- endpoint-specific `whsec_...` secret;
- timestamp tolerance.

### MoMo

Verify the exact provider-defined canonical signature string and all required fields. Validate:

- partner code;
- order ID;
- request ID;
- result code;
- amount;
- session/booking binding;
- provider transaction ID.

### Common webhook transaction

Implement a durable webhook inbox model:

```text
Provider
ProviderEventID
PayloadHash
ReceivedAt
ProcessingStatus
ProcessedAt
FailureReason
```

Add a unique index on `(Provider, ProviderEventID)`.

In one transaction or recoverable state machine:

1. record/claim the event;
2. find the gateway session;
3. confirm provider/session/amount/currency/booking consistency;
4. transition gateway payment with compare-and-set;
5. create PaymentHistory idempotently;
6. post the ledger credit idempotently;
7. update booking payment state;
8. enqueue notifications through an outbox;
9. mark event processed.

A crash after one step must be recoverable on retry. Do not return “duplicate succeeded” when PaymentHistory or ledger is missing.

Reference: Stripe raw-body signature verification  
`https://docs.stripe.com/webhooks/signature`

---

## P0.7 Unify payment verification and ledger posting

There must be one service operation for manual payment verification:

```js
verifyManualPaymentAndPostLedger({
  hostOwnerId,
  actorUserId,
  paymentId,
  idempotencyKey
})
```

It must:

- authorize host owner/staff permission;
- verify branch scope;
- compare-and-set payment `pending -> successful`;
- check successful net paid amount cannot exceed booking total;
- post exactly one ledger credit;
- update booking status according to policy;
- write audit log;
- enqueue notification;
- execute atomically or with a recoverable outbox.

Remove duplicate routes/services such as separate “verify” and “verify-ledger” implementations. Keep one canonical endpoint and update every UI caller.

Tests:

- double verify produces one successful payment and one ledger entry;
- concurrent verify requests cannot overpay;
- unauthorized host cannot verify;
- receptionist cannot verify;
- finance role can verify only permitted branches;
- UI calls the canonical endpoint.

---

# 6. P0 — Partner API authorization

## P0.8 Fix BOLA/IDOR in partner booking APIs

API-key scopes are not object authorization.

Required model additions:

```text
OwnerUserID
HostOwnerID / TenantID
AllowedBranchIDs
Scopes
Status
ExpiresAt
LastUsedAt
CreatedBy
```

Rules:

1. Only an authorized verified host owner or admin can create a partner API key.
2. The client cannot submit arbitrary scopes.
3. Requested scopes are intersected with a server allowlist.
4. Wildcard `*` scope is admin-only and normally prohibited.
5. API key responses never include hashes.
6. Raw key is returned once only.
7. API keys expire and support rotation/revocation.
8. Every data query enforces tenant ownership.

Booking lookup must resemble:

```js
Booking.findOne({
  _id: bookingId,
  HostID: req.apiKey.HostOwnerID,
  BranchID: { $in: req.apiKey.AllowedBranchIDs }
});
```

If Booking does not store `BranchID`, use a reliable snapshot/reference path or add a canonical BranchID field and migration.

Partner DTO must not expose private customer IDs, internal notes, bank data, or unrestricted snapshots.

Add:

- per-key rate limiting;
- audit events;
- last-used update without a write on every request if it causes contention;
- IP allowlist support if required;
- key prefix lookup plus constant-time hash comparison.

Tests:

- customer cannot create partner API key;
- host key cannot read another host's booking;
- branch-limited key cannot read another branch;
- missing scope rejected;
- scope alone cannot bypass object ownership;
- revoked/expired key rejected;
- response DTO contains no forbidden fields.

Reference: OWASP API1:2023 Broken Object Level Authorization  
`https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/`

---

# 7. P0 — Refund, ledger, and payout accounting

## P0.9 Implement partial-refund allocation correctly

Never mark every successful payment on a booking as fully refunded after a partial refund.

Add an allocation model or embedded allocation:

```text
RefundAllocation
- RefundID
- PaymentID
- Amount
- createdAt
```

Payment accounting must support:

```text
GrossSuccessfulAmount
RefundedAmount
NetPaidAmount
```

A payment is:

- `successful` while net amount remains;
- `partially_refunded` when refunded amount is between zero and payment amount;
- `refunded` only when fully refunded.

Refund processing must:

1. authorize customer/host/admin according to policy;
2. calculate net refundable amount;
3. reserve/approve refund atomically;
4. call provider refund for gateway payments where applicable;
5. allocate refund across payments deterministically;
6. post one idempotent ledger debit;
7. update refund status through a state machine:
   - requested;
   - approved;
   - processing;
   - completed;
   - failed;
   - rejected;
8. preserve provider reference and failure reason;
9. update financial reports from ledger/net payments, not booking totals;
10. enqueue notifications after commit.

Tests:

- partial refund preserves remaining successful amount;
- multiple partial refunds cannot exceed paid net;
- concurrent refunds cannot exceed paid amount;
- retry is idempotent;
- refund ledger debit occurs once;
- failed provider refund does not mark completed;
- another host cannot process refund;
- financial metrics use net revenue.

---

## P0.10 Make payout reservation atomic

Idempotency key is mandatory for payout requests.

Create or maintain a host financial account/balance projection with fields such as:

```text
AvailableBalance
ReservedBalance
PaidOutBalance
Version
```

Payout request transaction:

1. validate verified host and payout policy;
2. require recent 2FA/re-auth for high-risk amount if configured;
3. atomically reserve funds with a conditional update:
   ```js
   AvailableBalance: { $gte: amount }
   ```
4. create payout;
5. create ledger reservation/debit;
6. commit;
7. enqueue payout processing.

Concurrent payout requests must never reserve more than the available balance.

Payout processing state machine:

```text
requested -> processing -> paid
requested/processing -> failed
```

On failure, release reservation exactly once.

Store:

- bank account snapshot or provider beneficiary reference;
- provider transfer ID;
- processed by;
- timestamps;
- failure reason;
- idempotency key;
- audit record.

Never expose full bank account number after onboarding. Encrypt sensitive bank data at rest or tokenize it through the payout provider.

Tests:

- concurrent payouts cannot overspend;
- duplicate idempotency key returns same payout;
- same key cannot be reused for a different amount/user;
- failed payout restores funds once;
- paid payout cannot be processed again;
- another host cannot access/process payout;
- admin action is audited.

---

## P0.11 Ledger must be the financial source of truth

Define double-entry or at minimum balanced immutable ledger semantics.

Do not derive available balance by loading every ledger row into Node and summing indefinitely.

Required improvements:

- immutable posted entries;
- unique idempotency key;
- no update/delete of posted entries;
- correction through compensating entries;
- indexed `(HostID, Status, createdAt)`;
- indexed idempotency key;
- balance projection updated atomically;
- reconciliation command comparing:
  - gateway sessions;
  - PaymentHistory;
  - refund allocations;
  - payouts;
  - ledger entries;
  - projected balances.

Add:

```bash
npm run reconcile:finance -- --dry-run
npm run reconcile:finance -- --apply
```

`--apply` must require explicit confirmation and produce an audit report.

---

# 8. P1 — Booking correctness

## P1.1 Normalize booking state and hold expiry

Define one documented booking state machine.

A temporary unpaid reservation must use a state that the expiry job actually handles.

Recommended flow:

```text
draft
  -> hold
  -> awaiting_payment
  -> payment_under_review
  -> confirmed
  -> in-use
  -> completed
```

Alternative terminal states:

```text
expired
cancelled
rejected
no_show
```

Do not create `pending` with `HoldExpiresAt` while the expiry worker ignores `pending`.

Requirements:

- central transition policy;
- compare-and-set updates;
- actor/role authorization;
- transition audit;
- release slots when terminal;
- no direct status mutation outside booking service;
- migration for existing inconsistent bookings.

Add tests for every allowed and forbidden transition.

---

## P1.2 Fix slot granularity and adjacent-booking behavior

Choose one policy:

### Preferred simple policy

Require booking start/end aligned to `BOOKING_SLOT_MINUTES`.

Validate on server:

```text
timestamp modulo slot duration == 0
```

UI must use the same rule.

### Alternative

Implement exact non-overlap locking without floor-bucket false conflicts.

Whichever policy is chosen, these must pass:

- 10:00–10:30 and 10:30–11:00 both succeed;
- 10:00–10:30 and 10:29–11:00 conflict;
- buffer/cleanup rules work symmetrically;
- concurrent overlapping bookings produce exactly one success;
- stale expired slots do not block new bookings.

Use a database-enforced uniqueness strategy and transaction. A memory lock is not sufficient for multi-instance production.

Redis lock behavior must fail closed for critical booking operations when distributed locking is required. Do not silently fall back to a per-process lock in production.

---

## P1.3 Move stale-hold cleanup out of request hot paths

Remove probabilistic cleanup middleware from normal requests.

Create a scheduled worker with:

- lease/leader lock;
- batch size;
- indexed query;
- booking and slot cleanup in the same transaction;
- metrics;
- structured logging;
- retry;
- no overlapping runs.

Add commands:

```bash
npm run worker
npm run jobs:expire-holds
```

Production process architecture should separate web and worker processes where possible.

---

## P1.4 Make coupon redemption atomic

Coupon validation and redemption must occur in the same transaction as booking creation.

Requirements:

- atomic global usage limit;
- atomic per-user limit;
- unique redemption constraints;
- do not apply discount if redemption fails;
- do not swallow redemption exceptions;
- release or compensate redemption if booking creation rolls back;
- prevent reuse through recurring/group flows;
- record original coupon snapshot for receipts.

Use conditional update:

```js
{
  _id: couponId,
  UsedCount: { $lt: UsageLimit }
}
```

together with a unique redemption key.

Tests must include concurrent final-use coupon requests.

---

## P1.5 Reserve add-on inventory atomically

Do not only check inventory.

For finite inventory:

- reserve/decrement atomically during booking transaction;
- reject insufficient inventory;
- release on booking expiry/cancellation according to policy;
- support quantity and per-hour rules;
- prevent negative stock;
- preserve add-on price snapshot.

Add concurrency tests for the last available unit.

---

## P1.6 Fix recurring bookings

Requirements:

- correct daily and weekly interval semantics;
- branch timezone, not server local timezone;
- DST-safe date handling where relevant;
- requested occurrence count honored up to a documented maximum;
- preview and create use the same generator;
- clear partial-success policy:
  - atomic all-or-nothing; or
  - explicitly return partial results and allow retry;
- store series ID on each child booking;
- cancellation modes:
  - this occurrence;
  - this and future;
  - whole series;
- cancel future child bookings and release slots;
- no cancellation of completed/in-use occurrences;
- idempotent create and cancel;
- no more than configured maximum writes per request;
- large series through background job if necessary.

Tests for weekly interval > 1, multi-day weeks, timezone boundary, partial conflicts, and series cancellation.

---

## P1.7 Harden group booking and RSVP

Requirements:

- validate attendee count against `Space.Capacity`;
- validate attendee email using a proper validator;
- hash RSVP tokens in DB;
- expiry and revocation;
- revoke tokens when booking is cancelled;
- rate limit public RSVP endpoints;
- generic invalid-token response where appropriate;
- minimize public booking data;
- do not expose attendee email/name unless needed;
- organizer can regenerate/revoke invite;
- RSVP updates are idempotent;
- audit status changes;
- send invite emails through jobs/outbox;
- sanitize notes.

---

## P1.8 Replace predictable check-in codes

Do not derive a check-in code from ObjectId suffixes.

Generate a random, unique, indexed code with:

- at least 64 bits of entropy for QR token;
- human code with sufficient entropy and rate limiting;
- hash stored in DB where feasible;
- booking ID binding;
- host binding;
- expiry;
- one-time or state-aware use;
- rotation/revocation;
- no list scanning.

Check-in policy must verify:

- booking belongs to acting host;
- staff has branch permission;
- booking status is confirmed;
- current time is inside allowed early/late window;
- code not expired/revoked;
- no duplicate check-in.

No-show policy must verify booking start plus grace period has passed. Add an explicit `no_show` state if appropriate instead of overloading `cancelled`.

---

## P1.9 Enforce staff branch scope

Extend host context:

```js
req.hostContext = {
  hostOwnerId,
  staffRole,
  allowedBranchIds,
  isOwner
}
```

Owner may access all branches. Staff may access only assigned branches.

Every staff operation must apply branch scope:

- inbox;
- reception;
- calendar;
- booking confirmation;
- check-in;
- no-show;
- payments;
- refunds;
- reports;
- messages;
- content/media;
- incidents;
- bulk operations.

Do not accept a branch ID from header/body without membership verification.

Add matrix tests for every role:

- owner;
- manager;
- receptionist;
- finance;
- content editor;
- support.

Include cross-branch denial tests.

---

# 9. P1 — Sessions, admin, and account security

## P1.10 Implement real per-session revocation

A session table that is not referenced by JWT validation cannot revoke one device.

Add a random `sid` claim to JWT.

On every authenticated request:

- verify JWT;
- load/cache session by `sid`;
- ensure session belongs to user;
- ensure not revoked;
- ensure token version matches;
- ensure user remains active;
- update last seen with throttling, not every request.

Operations:

- list sessions;
- revoke one session;
- logout current session;
- logout all sessions;
- admin force logout;
- password change revokes all sessions;
- 2FA changes revoke other sessions according to policy.

Store hashed session/token identifiers where appropriate.

---

## P1.11 Make admin 2FA consistent for pages and APIs

When admin 2FA is required:

- API routes must enforce it;
- admin page middleware must redirect to `/security` before rendering protected pages;
- the security setup page remains accessible;
- feature flag result is cached safely;
- no UI shell loads protected data and then fails with 403.

High-risk admin actions should require recent re-authentication or a step-up timestamp.

---

## P1.12 Password policy and reset hardening

Use a stronger password policy without arbitrary composition rules that harm usability. At minimum:

- length >= 10 or 12;
- block known breached/common passwords if feasible;
- allow password managers and long passwords;
- cap maximum length to prevent hashing DoS;
- rate limit by IP and normalized account key;
- hash reset tokens;
- atomic attempt counting;
- invalidate token after max attempts;
- reset revokes all sessions;
- generic response;
- no OTP/token in logs;
- consistent email delivery behavior.

---

# 10. P1 — Frontend CSP and DOM safety

## P1.13 Remove all unsafe dynamic `innerHTML` and inline event handlers

Audit every file under:

```text
public/js/
views/
```

especially host spaces, booking, payment, membership, messages, staff, finance, recurring, group, RSVP, notifications, admin, and support screens.

User/host/admin-controlled content must use:

- `textContent`;
- `createElement`;
- `setAttribute` after validation;
- `addEventListener`;
- safe URL allowlist;
- safe image helper.

Remove:

```html
onclick=""
onerror=""
onchange=""
```

from runtime-generated HTML and EJS.

Do not treat a home-grown `escapeHtml()` as sufficient for URL, attribute, JavaScript, or CSS contexts.

For image URLs, allow only:

- HTTPS;
- known Cloudinary/CDN hostnames;
- same-origin uploads;
- explicitly supported data/blob URLs only in local previews.

Block:

- `javascript:`;
- malformed schemes;
- quote-breaking attributes;
- attacker-controlled SVG where not sanitized.

Add jsdom or browser tests proving common XSS payloads render as text and no inline handlers exist.

---

## P1.14 Make CSP production-strict

Target policy:

- no inline script handlers;
- nonce only for unavoidable inline scripts;
- prefer moving inline scripts into external files;
- no Tailwind runtime CDN in production;
- minimize third-party script origins;
- add `upgrade-insecure-requests` in production where appropriate;
- keep `object-src 'none'`;
- keep `frame-ancestors 'none'`;
- validate map iframe source;
- document CSP exceptions.

Add a CI grep/check that rejects new inline event attributes.

---

# 11. P1 — Build, assets, PWA, and CI

## P1.15 Fail the build when CSS generation fails

Remove:

```dockerfile
RUN npm run build:css || true
```

Use:

```dockerfile
RUN npm run build:css
RUN test -s public/css/app.min.css
```

CI must execute the same production build path.

Do not use inline `onerror` for stylesheet fallback. Build the required stylesheet deterministically.

---

## P1.16 Use content-hashed production assets

Do not serve mutable names with `immutable`.

Implement a build manifest:

```text
main.<hash>.js
style.<hash>.css
```

EJS helpers should resolve logical names through the manifest.

Cache policy:

- hashed assets: one year, immutable;
- service worker: no-cache;
- HTML: no-store/private as appropriate;
- unhashed assets: short cache without immutable;
- uploads: appropriate cache based on immutable public ID.

Update service-worker precache from the build manifest. Remove stale caches safely and avoid caching personalized pages.

---

## P1.17 Strengthen lint and CI

Change lint coverage to include the whole source tree:

```json
"lint": "eslint . --max-warnings=0"
```

Configure ignores explicitly.

CI must run:

```bash
npm ci
npm run format:check
npm run lint
npm test
npm run build:css
npm run test:e2e
npm run audit:prod
```

Required improvements:

- add Playwright to dev dependencies;
- install Chromium in CI;
- start the app and wait for `/health/ready`;
- E2E must fail, not exit 0, when Playwright/browser/server is missing;
- remove Jest `--forceExit`;
- close DB, Socket.IO, timers, Redis, and worker handles cleanly;
- upload test reports/artifacts on failure;
- test production environment configuration;
- build Docker image in CI;
- optionally scan container/SBOM.

---

# 12. P1 — SEO, redirects, health, and performance

## P1.18 Use a validated canonical base URL

Never build canonical URLs, sitemap URLs, OAuth redirect URIs, or email links directly from an untrusted Host header.

Require:

```env
PUBLIC_BASE_URL=https://example.com
```

Validate at startup:

- absolute HTTPS URL in production;
- no path/query;
- allowed hostname.

Use it for:

- canonical;
- Open Graph;
- sitemap;
- robots sitemap lines;
- email links;
- OIDC redirect;
- payment return URLs;
- ICS feed links.

---

## P1.19 Prevent open redirects and regex abuse

SEO redirect destinations must be either:

- internal paths beginning with exactly one `/`; or
- absolute URLs on an explicit allowlist.

Reject:

- protocol-relative `//evil.example`;
- `javascript:`;
- data URLs;
- CRLF;
- loops;
- chains beyond a documented limit.

Escape or remove dynamic RegExp fallback from slug lookup. Do not construct regex directly from URL path input.

Add redirect-loop and external-domain tests.

---

## P1.20 Protect operational endpoints

Public endpoints may expose only minimal liveness/readiness.

Recommended:

```text
/health/live
/health/ready
/status
```

Protect or network-restrict:

```text
/metrics
/health/details
/admin/system-health
```

Do not expose public:

- Node version;
- app dependency details;
- Redis configuration;
- memory internals;
- payment provider;
- internal metrics;
- stack traces.

Prometheus endpoint should use internal network policy, mTLS, API key, or a secret header depending on deployment.

---

## P1.21 Replace in-process geo filtering

Use GeoJSON and MongoDB `2dsphere`.

Example model field:

```js
Location: {
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: [Number] // [longitude, latitude]
}
```

Create:

```js
schema.index({ Location: '2dsphere' });
```

Use `$near`/`$geoNear`, deterministic pagination, and maximum radius.

Provide migration from existing latitude/longitude.

---

# 13. P2 — Feature completion and architecture

## P2.1 Membership must not activate without payment

For plans with `MonthlyPrice > 0`:

- create pending subscription;
- create provider checkout;
- activate only after verified webhook;
- idempotent renewal;
- cancellation and expiration;
- credit consumption transaction;
- prevent negative credits;
- document free-plan behavior separately.

Until implemented, disable paid membership subscribe via feature flag.

---

## P2.2 Job queue reliability

Current jobs must support:

- atomic claim;
- lease expiry;
- recovery of stuck `running` jobs;
- exponential backoff;
- max attempts;
- dead-letter link to original job;
- idempotent handlers;
- owner authorization on retry/status/download;
- worker heartbeat and metrics;
- cleanup of old export files;
- safe CSV generation.

CSV exports must prevent formula injection by prefixing cells beginning with:

```text
= + - @
```

Do not write sensitive exports to a local ephemeral disk when running multiple instances. Use object storage with expiring signed downloads.

---

## P2.3 Route and service consolidation

Search for duplicate functionality across:

```text
hostRoutes
platformRoutes
growthRoutes
customer routes
page routes
```

Consolidate:

- payment verification;
- membership endpoints;
- booking quote;
- host finance;
- notifications;
- sessions;
- check-in;
- recurring preview;
- admin health.

One business operation must have one canonical service method.

---

## P2.4 Validation and DTO boundaries

Use Zod schemas for every mutating endpoint and significant query.

Validate:

- ObjectIds;
- dates;
- enums;
- pagination;
- money integer ranges;
- arrays and maximum sizes;
- URLs;
- timezones;
- filenames;
- note lengths;
- scopes;
- redirect paths;
- provider event fields.

Do not return raw Mongoose documents. Use presenters/DTOs for:

- users;
- bookings;
- payments;
- refunds;
- payouts;
- API keys;
- staff;
- notifications;
- public host profiles.

---

## P2.5 Upload security

Verify:

- file size;
- file count;
- magic bytes;
- extension;
- MIME;
- image dimensions;
- decompression bombs;
- PDF policy;
- ownership before deletion;
- Cloudinary public ID parsing;
- no SVG unless sanitized;
- no executable uploads;
- no public business verification documents.

Cloudinary deletion must occur only after the database ownership check.

---

## P2.6 Logging, privacy, and audit

Structured logs must:

- include request ID;
- redact authorization, cookies, OTPs, reset tokens, API keys, bank numbers, webhook secrets, passkey payloads;
- distinguish operational and programmer errors;
- avoid full third-party error payloads in public responses.

Audit high-risk actions:

- login and failed login;
- 2FA changes;
- passkey changes;
- Google account link;
- password reset;
- role/status changes;
- host verification;
- payment verification/rejection;
- refund/payout processing;
- staff invitation/revocation;
- API key lifecycle;
- booking/manual state changes;
- export generation/download;
- feature flag changes;
- force logout.

Audit records should be append-only.

---

# 14. Required regression test suites

Create or update suites grouped as follows.

## Authentication

- local registration/email verification;
- password login;
- banned/inactive user;
- password reset;
- tokenVersion;
- single-session revoke;
- logout all;
- TOTP setup/enable/disable/login/recovery;
- admin 2FA requirement;
- Google OIDC verification;
- WebAuthn strict verification.

## Authorization

- customer booking ownership;
- host booking ownership;
- admin boundaries;
- partner API tenant ownership;
- staff role matrix;
- staff branch matrix;
- job ownership;
- receipt/timeline/message ownership;
- upload/delete ownership.

## Booking

- allowed/forbidden transitions;
- adjacent slots;
- overlap race;
- stale holds;
- buffer/cleanup;
- blackout;
- pricing;
- coupon race;
- add-on inventory race;
- recurring series;
- group capacity/RSVP;
- reschedule;
- check-in/no-show.

## Finance

- pending payment creation;
- server-calculated amount;
- gateway provider lock;
- raw webhook verification;
- webhook retry after partial failure;
- event idempotency;
- manual verify + ledger;
- overpayment race;
- partial refund;
- refund race;
- payout race;
- ledger reconciliation;
- net revenue report.

## Frontend/security

- DOM XSS payloads;
- no inline event handlers;
- strict CSP;
- CSRF for cookie-auth mutations;
- public endpoint rate limits;
- safe redirect;
- canonical base URL;
- asset manifest;
- service-worker cache policy.

## CI/E2E

At minimum, E2E must cover:

1. customer registration and verification;
2. customer login;
3. search and detail page;
4. booking;
5. payment initiation;
6. host login;
7. host booking/payment action;
8. admin protected page;
9. CSP console errors;
10. accessibility smoke;
11. production CSS present;
12. mock payment unavailable under production config.

---

# 15. Database indexes and migrations

Review every model and add only useful indexes.

Mandatory candidates:

```text
WebAuthnChallenge:
  unique challenge hash / purpose / consumed / expiry TTL

WebAuthnCredential:
  unique CredentialId
  UserID + createdAt

WebhookEvent:
  unique Provider + ProviderEventID
  ProcessingStatus + ReceivedAt

GatewayPayment:
  unique provider + session/provider reference
  BookingID + Status
  CustomerID + createdAt
  scoped idempotency key

PaymentHistory:
  BookingID + Status
  HostID + Status + createdAt
  CustomerID + createdAt
  unique scoped idempotency key

RefundAllocation:
  RefundID + PaymentID
  PaymentID + createdAt

Payout:
  HostID + Status + createdAt
  unique scoped idempotency key

LedgerEntry:
  unique IdempotencyKey
  HostID + Status + createdAt
  BookingID + createdAt

Booking:
  SpaceID + Status + StartTime + EndTime
  HostID + Status + StartTime
  CustomerID + createdAt
  HoldExpiresAt + Status

BookingSlot:
  unique SpaceID + SlotStart

CouponRedemption:
  unique CouponID + UserID + BookingID
  CouponID + UserID

StaffMember:
  unique HostOwnerID + UserID
  UserID + Status

CheckInCredential:
  unique code hash
  BookingID + expiry

Session:
  unique SidHash
  UserID + RevokedAt + LastSeenAt

Branch:
  Location 2dsphere
```

Provide:

```bash
npm run migrate -- --dry-run
npm run migrate -- --apply
npm run indexes:verify
```

Never silently build dangerous indexes in a request handler.

---

# 16. Environment validation

Create one typed environment module and fail startup on invalid production configuration.

Validate at least:

```env
NODE_ENV
PORT
MONGO_URI
JWT_SECRET
AUTH_COOKIE_NAME
COOKIE_SECURE
PUBLIC_BASE_URL
TRUST_PROXY

WEBAUTHN_ENABLED
WEBAUTHN_RP_ID
WEBAUTHN_ORIGIN

GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI

PAYMENT_PROVIDER
ALLOW_MOCK_PAYMENT_PROVIDER
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
MOMO_PARTNER_CODE
MOMO_ACCESS_KEY
MOMO_SECRET_KEY

REDIS_URL
ENABLE_TRANSACTIONS

METRICS_AUTH_TOKEN
```

Rules:

- no fallback from payment/webhook secrets to JWT secret;
- JWT secret minimum entropy/length;
- secure cookies required in production;
- HTTPS public URL required in production;
- mock auth/payment disabled in production;
- transactions required for financial operations;
- explicit trust proxy configuration;
- environment validation happens before server listens.

Update `.env.example` with placeholders only.

---

# 17. Expected package/tooling changes

Add only maintained dependencies required for secure implementation, likely including:

```text
@simplewebauthn/server
google-auth-library
stripe
luxon or date-fns-tz
playwright
```

Use exact or controlled semver policy according to the repository standard.

Run:

```bash
npm audit --omit=dev --audit-level=high
```

Do not use `--force` blindly. Explain every dependency upgrade that introduces breaking changes.

---

> **Progress (2026-07-10):** P0+P1 batch: staff branch scope, coupon/add-on atomic, recurring cancel slots, check-in random codes/no-show grace, UI security guard, deploy docs. Remaining: full XSS purge, Playwright hard-fail, remove forceExit, full-repo lint zero.

# 18. Definition of Done

The task is complete only when all conditions below are true.

## Security

- [x] Passkey cannot authenticate without a valid cryptographic assertion. *(fail-closed WEBAUTHN_ENABLED=false; stub rejected; crypto mandatory when enabled)*
- [x] Google ID token signature and claims are verified. *(google-auth-library; no silent email takeover)*
- [x] Email verification gates local account activation. *(local customers inactive until confirm)*
- [x] Production has no mock payment completion route.
- [x] Production cannot select/fall back to mock providers.
- [x] Payment amount is computed server-side. *(paymentType only)*
- [x] Webhooks use exact raw body and durable idempotency. *(express.raw + WebhookEvent)*
- [x] Partner API enforces tenant/object authorization. *(HostOwnerID + branch + DTO)*
- [x] Staff branch scope is enforced. *(hostContext.allowedBranchIds; reception/calendar/check-in/confirm/no-show)*
- [x] Metrics/details are not publicly exposed. *(METRICS_AUTH_TOKEN)*
- [x] Dynamic frontend content cannot create executable markup. *(partial: DomSafe + lint:security-ui critical files; host-spaces/history debt)*
- [x] No inline event handlers remain. *(partial: CI guard critical JS; views/legacy debt tracked)*

## Financial correctness

- [x] Successful paid amount never exceeds booking total.
- [x] Partial refunds preserve remaining net payment. *(RefundAllocation)*
- [x] Concurrent refunds cannot over-refund. *(CAS + net)*
- [x] Concurrent payouts cannot overspend. *(HostBalance reserve)*
- [x] Every successful payment has exactly one ledger credit. *(verifyManualPaymentAndPostLedger)*
- [x] Every completed refund has exactly one ledger debit.
- [x] Every payout reservation/release is balanced.
- [x] Reconciliation reports zero unexplained differences. *(reconcile:finance)*

## Booking correctness

- [x] Adjacent valid bookings work.
- [x] Concurrent overlap permits one winner only.
- [x] Expired holds release slots. *(pending included)*
- [x] Coupon and add-on races are safe. *(atomic UsedCount + inventory decrement)*
- [x] Recurring cancellation releases future slots. *(whole/this/this_and_future; slots deleted)*
- [x] Check-in/no-show policies enforce time and ownership. *(random hashed codes; windows; no_show status)*

## Delivery quality

- [x] `npm ci` passes.
- [ ] formatting check passes. *(not gated in CI yet)*
- [ ] lint covers the whole repository with zero warnings. *(partial paths + lint:security-ui)*
- [ ] unit/integration tests pass without `--forceExit`. *(still uses forceExit)*
- [x] production CSS build passes. *(Dockerfile no || true)*
- [ ] Playwright E2E actually runs and passes. *(script still skip-safe optional)*
- [x] production Docker image builds. *(Dockerfile requires CSS; image path documented)*
- [x] production configuration safety tests pass. *(env.js + P0 suite)*
- [x] high-severity production dependency audit passes or is explicitly documented with a safe mitigation. *(docs/SECURITY_AUDIT_PROD.md)*
- [x] README and deployment documentation are updated.
- [x] no secrets are committed.
- [x] git status contains only intentional changes.

---

# 19. Required final response from the coding agent

At completion, return exactly these sections:

## A. Repository state

- starting SHA;
- ending SHA;
- branch;
- files changed;
- migrations added.

## B. P0 fixes

For each P0 item:

- root cause;
- implementation;
- tests;
- remaining risk.

## C. P1/P2 fixes

Group by subsystem.

## D. Security invariants

List the invariants now enforced, especially authentication, ownership, booking concurrency, and financial accounting.

## E. Commands executed

Include exact commands and exit status:

```text
npm ci
npm run format:check
npm run lint
npm test
npm run build:css
npm run test:e2e
npm run audit:prod
docker build ...
```

## F. Test results

Include suite count, test count, skipped count, and explain every skip. Security-critical tests may not be skipped.

## G. Manual deployment steps

Include:

- new environment variables;
- migrations/index creation;
- worker process;
- webhook configuration;
- provider configuration;
- feature flags;
- rollback instructions.

## H. Remaining limitations

Be explicit. Do not claim production-ready if any P0 item remains unresolved.

---

# 20. Final instruction

Do not add more product features.

First make existing authentication, payment, refund, payout, booking, staff, frontend, deployment, and CI behavior safe and internally consistent.

A green test suite is not sufficient if the test suite validates a bypass. Security tests must prove invalid requests are rejected, valid requests succeed, and concurrency preserves invariants.
