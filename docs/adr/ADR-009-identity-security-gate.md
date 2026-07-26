# ADR 009: M6 Identity Security Gate

## Status
Accepted

## Context

The M6 extraction moved the full auth surface into `services/identity-service`,
but the supporting security machinery was still prototype-grade. A pre-cutover
review found ten defects that individually block a production canary, and one
that was already breaking a real flow:

1. `outboxService` was a shim that called Resend directly. The `session` and
   `idempotencyKey` arguments its callers passed were accepted and discarded, so
   a rolled-back registration could still send a verification email, and a mail
   provider outage silently lost the notification for a committed one.
2. RSA signing keys were generated at boot when none was configured, with no
   production guard — every restart invalidated all outstanding tokens.
3. TOTP seeds were encrypted under a key derived from `IDENTITY_INTERNAL_SECRET`,
   and `decryptSecret` returned malformed ciphertext *as if it were plaintext*.
4. The pre-auth 2FA token was signed with `JWT_SECRET` — the same key as access
   tokens — carried no `aud`/`iss`/`typ`/`jti`, and had no one-time record, so it
   was replayable for its full five-minute lifetime.
5. `disable2fa` ran `bcrypt.compare()` against Argon2id hashes. Since
   registration hashes with Argon2id, **no user could ever disable 2FA**.
6. Password reset used a bare SHA-256 of a six-digit OTP (trivially reversible
   with a 10⁶ table), non-atomic attempt counting, and a non-atomic consume, so
   concurrent requests could all succeed.
7. identity-service had no CSRF protection at all, and no `GET /api/auth/csrf`.
   Enabling the canary would have silently dropped CSRF from logout,
   change-password, session, 2FA and WebAuthn endpoints.
8. Both gateway and identity accepted monolith HS256 tokens indefinitely.
9. The gateway held its own Mongoose connection to the identity collections and
   cached introspection results in an unbounded `Map` **keyed by the raw JWT**.
10. Host registration was routed to identity, which accepted it while silently
    dropping the business-verification document the monolith collects.

## Decisions

### Transactional outbox, and Communication owns email

Identity records intent in `identity_outbox` inside the same Mongo transaction
as the state change. A separate worker publishes with publisher confirms, lease
claiming, exponential backoff with full jitter, a max-attempt ceiling and a
`dead` state mirrored to the DLQ. Identity has no email provider code at all;
`identity.email-requested.v1` is consumed by Communication Service.

Outbox rows carrying a secret are stored as keyring ciphertext and decrypted
only at publish time, so a database backup never contains a live reset OTP.

**Audit is a local collection, not an event.** Identity owns its audit trail;
shipping it over the broker would add a delivery failure mode to a record that
must not be lossy. It is written in the caller's transaction.

### One key per purpose, no derivation

`JWT_SECRET`, `IDENTITY_PREAUTH_JWT_SECRET`, `IDENTITY_CSRF_SECRET`,
`PASSWORD_RESET_PEPPER`, `IDENTITY_TOTP_ENCRYPTION_KEY` and
`IDENTITY_OUTBOX_PAYLOAD_ENCRYPTION_KEY` are independent, all required in
production, and production boot fails if any equals `JWT_SECRET`.

Deriving the TOTP key from `IDENTITY_INTERNAL_SECRET` coupled seed recoverability
to a routine credential rotation: rotating the service-mesh secret would have
destroyed every stored TOTP seed.

### Fail closed on cryptographic error

A seed that cannot be decrypted — malformed ciphertext, unknown key version,
failed GCM tag — raises rather than returning a value. Verification paths treat
that as "2FA is broken for this account", never as a pass.

### Token types are not interchangeable

Separate validation functions per type, each pinning `alg`, `iss`, `aud` and
`typ`. Cross-presentation is covered by tests in both directions.

### Concurrency guarded at the database, not in application logic

Every single-use credential is spent with a conditional update, so the loser of
a race observes the loss:

- pre-auth token: `findOneAndUpdate({ JtiHash, ConsumedAt: null })`
- recovery code: `updateOne({ _id, TotpRecoveryHashes: hash }, { $pull })`
- reset OTP attempts: `$inc` guarded by `$expr: { $lt: ["$Attempts", "$MaxAttempts"] }`
- reset consume: `findOneAndUpdate({ _id, UsedAt: null })` inside the transaction
  that also changes the password and revokes sessions

### The gateway holds no database connection

Mongoose is removed from the gateway entirely. Identity state is reached only
through JWKS (local signature verification) and introspection (liveness).
Legacy HS256 tokens are forwarded to introspection rather than verified against
a second copy of the user table — two readers of the same collection can
disagree about whether a session is still valid.

The introspection cache is a bounded LRU keyed by `SHA-256(token)`, with a TTL
and eviction on revocation endpoints. The raw JWT is never a cache key: the
cache is long-lived memory that appears in heap dumps, and a raw JWT there is a
usable credential.

### Legacy HS256 sunsets on a date, not on a memory

`IDENTITY_LEGACY_JWT_ENABLED` plus `IDENTITY_LEGACY_JWT_DEADLINE`, honoured
identically by gateway and identity. Once the deadline passes, HS256 is refused
without anyone flipping a flag.

### Host registration stays on the facade

Identity refuses `role: host` unless the caller is the approved internal
onboarding saga, and the gateway keeps host registrations on the monolith
regardless of canary percentage. This is the one endpoint where the gateway
inspects a request body; it is parsed for `POST /api/auth/register` only and
re-streamed with `fixRequestBody`.

## Consequences

- Production deployment now requires ~8 new secrets. `npm run keys:generate`
  emits a complete set; the service fail-fasts with a named variable otherwise.
- Rotating the TOTP key requires running `npm run rotate:totp-keys` during the
  overlap window before retiring the old key.
- The gateway depends on identity-service being reachable for **all**
  authenticated traffic, including legacy tokens. Mutations return 502 during an
  identity outage rather than proceeding unauthenticated. This is a deliberate
  availability-for-correctness trade.
- Clients calling identity endpoints directly must fetch `GET /api/auth/csrf`
  and send `X-CSRF-Token`, matching the monolith's existing contract.

## Not done

- **Distributed rate limiting.** Reset-OTP attempt counting is atomic in Mongo
  and therefore correct across replicas, but the per-IP limiters remain
  `express-rate-limit` in-memory, so budgets are per-instance. Moving these to
  Redis is tracked separately.
- **Password reset remains a six-digit OTP** rather than a 32-byte token, to
  preserve the existing client contract. All the hardening the alternative
  called for (pepper, constant-time compare, atomic attempts and consume) is in
  place.
