# WorkHub Identity Service

Strangler-fig microservice owning user authentication, session revocation, MFA
and passkey credentials.

## Endpoints

### Public

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/auth/csrf` | Issues the signed double-submit CSRF token |
| `POST` | `/api/auth/register` | Customer only — see *Host registration* below |
| `POST` | `/api/auth/login` | Returns a session, or `requires2fa` + `pendingToken` |
| `POST` | `/api/auth/2fa/verify` | Redeems a single-use `pendingToken` |
| `POST` | `/api/auth/logout` | Revokes the current session |
| `GET` | `/api/auth/me` | Current principal |
| `POST` | `/api/auth/change-password` | Revokes all sessions |
| `POST` | `/api/auth/forgot-password` / `reset-password` | Peppered OTP flow |
| `POST` | `/api/auth/email/request-verify` / `email/confirm` | Email verification |
| `*` | `/api/auth/2fa/*`, `/api/auth/webauthn/*`, `/api/auth/google/*` | MFA, passkeys, OIDC |
| `GET`/`DELETE`/`POST` | `/api/sessions*` | Session listing and revocation |

### Internal (internal secret required, never cookie-authenticated)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/internal/auth/introspect` | Token liveness for the gateway |
| `GET` | `/.well-known/jwks.json` | Public key set, ETag + `Cache-Control` |

`/internal/*` is exempt from CSRF by design — those callers authenticate with
`X-Internal-Token`, so there is no ambient browser credential to protect.

## Security model

**Tokens.** Three types, deliberately non-interchangeable — different keys,
issuers, audiences and `typ` headers, so one can never be replayed as another:

| Type | Alg | Issuer | Audience | `typ` |
|---|---|---|---|---|
| Access | RS256 | `workhub-identity` | `workhub-api-gateway` | `at+jwt` |
| Legacy access (sunset) | HS256 | `workhub-auth` | `workhub-app` | — |
| Pre-auth 2FA | HS256, own key | `workhub-identity` | `workhub-2fa` | `workhub-preauth-2fa+jwt` |

Pre-auth tokens are backed by a one-time `pending_auth_tokens` row; the second
presentation of a `jti` finds nothing to consume and gets a 401.

**Keys.** Production fail-fasts without a persistent RS256 key — generating one
at boot would invalidate every outstanding token on restart. Rotation is:
publish the new key as active, keep the outgoing public half in
`IDENTITY_JWT_PREVIOUS_PUBLIC_KEYS` for one token lifetime, then move its kid to
`IDENTITY_JWT_RETIRED_KIDS`.

**TOTP seeds** are AES-256-GCM encrypted with the user id as AAD, under a
versioned keyring. Malformed ciphertext, an unknown key version, or a failed
authentication tag all fail closed — a seed that cannot be decrypted never
counts as a successful verification.

**Passwords.** All hashing and verification goes through `utils/password.js`.
New hashes are Argon2id (OWASP 2024 second-choice profile); legacy bcrypt still
verifies and is upgraded in place on the next successful login.

**CSRF.** Signed double-submit token, Origin/Referer allowlist, and Fetch
Metadata, applied to every cookie-authenticated mutation. Bearer callers are
exempt because an `Authorization` header is not sent ambiently.

**Host registration** is refused here until the Catalog (M7) onboarding saga
exists — host signup needs business verification and a Catalog-owned profile.
Until then the monolith facade owns it, and the gateway keeps host registrations
off this service regardless of canary percentage. An approved internal caller
(`X-Service-Name: onboarding-saga` plus the internal secret) may still create a
host principal.

## Events

Identity never contacts an email provider. It records intent in a transactional
outbox (`identity_outbox`) written in the same Mongo transaction as the state
change, and `workers/outboxPublisher.js` publishes with publisher confirms,
lease-based claiming, exponential backoff with full jitter, a max-attempt
ceiling, and a `dead` state mirrored to the DLQ.

Published events: `identity.user-created.v1`, `identity.user-status-changed.v1`,
`identity.email-verified.v1`, `identity.password-changed.v1`,
`identity.mfa-changed.v1`, `identity.session-created.v1`,
`identity.session-revoked.v1`, `identity.all-sessions-revoked.v1`,
`identity.email-requested.v1`.

`identity.email-requested.v1` is consumed by Communication Service, which owns
delivery, templating and retries. Rows carrying a secret (verification token,
reset OTP) are stored as ciphertext and decrypted only at publish time.

## Configuration

Generate a full production secret set:

```bash
npm run keys:generate --workspace=@workhub/identity-service
```

Every variable is documented in the root `.env.example`. Production requires
`IDENTITY_JWT_ACTIVE_KID`, a private key, `IDENTITY_PREAUTH_JWT_SECRET`,
`IDENTITY_CSRF_SECRET`, `PASSWORD_RESET_PEPPER`, `IDENTITY_TOTP_ENCRYPTION_KEY`,
`IDENTITY_TOTP_KEY_VERSION` and `IDENTITY_ALLOWED_ORIGINS`; none of them may
equal `JWT_SECRET`.

### Rotating the TOTP key

```bash
npm run rotate:totp-keys --workspace=@workhub/identity-service -- --dry-run
```

Promote the new key, keep the old one in `IDENTITY_TOTP_PREVIOUS_KEYS`, run the
migration, then drop the old key. The script verifies each re-encrypted seed
round-trips before writing it.

## Tests

```bash
npm test --workspace=@workhub/identity-service
```

`test/outbox.test.js` includes real-broker coverage, enabled with
`IDENTITY_TEST_RABBITMQ=1` (CI sets it) and skipped otherwise.
