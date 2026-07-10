# ASVS 5.0 L2 — WorkHub threat model (baseline)

Scope: auth, booking, payment, upload, admin.

## Assets

| Asset | Impact if compromised |
|-------|------------------------|
| User session JWT | Account takeover |
| Host finance / ledger | Fraudulent payouts |
| Payment webhooks | Fake payment confirmation |
| Upload documents | Malware / PII leak |
| Admin panel | Full platform control |

## Trust boundaries

1. **Browser → Edge/App**: TLS; CSRF on cookie mutations; CSP nonces.
2. **App → MongoDB**: private network; prefer TLS (`MONGODB_URI` with `tls=true`).
3. **App → Payment providers**: signed webhooks; raw body verify.
4. **App → Object storage/CDN**: no public write; signed deletes after ownership check.

## Threats & controls (L2-oriented)

| Threat | Control in WorkHub |
|--------|-------------------|
| Credential stuffing | Rate limits on login/register; generic errors |
| Session theft | HttpOnly cookie; tokenVersion; optional 2FA |
| Passkey bypass | WEBAUTHN_ENABLED fail-closed; crypto required |
| OIDC forgery | google-auth-library verify |
| Booking race / double book | Slot unique index + service locks |
| Payment amount tampering | Server-side paymentType amounts |
| Webhook replay | WebhookEvent unique Provider+EventID |
| IDOR booking/partner | Host/customer ownership in queries |
| Staff cross-branch | allowedBranchIds on hostContext |
| Upload XSS / malware | magic bytes; optional ClamAV; no SVG exec |
| Admin abuse | requireAdmin + optional admin 2FA |
| Log leakage | audit redaction; structured logger |

## Residual risks

- Full ASVS questionnaire not automated.
- Secrets manager is deployment concern (see `docs/OPS_SECURITY.md`).
- Multi-region DR not in scope of this baseline.

Review at least quarterly or after payment-provider changes.
