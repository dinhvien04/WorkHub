# Production dependency audit notes

Last reviewed: 2026-07-10

## Policy

- Run `npm run audit:prod` (`npm audit --omit=dev --audit-level=high`) in CI.
- Prefer `npm audit fix` without `--force`.
- Document residual highs with mitigation; do not ignore silently.

## Residual issues (post-install)

| Package | Severity | Mitigation |
|---------|----------|------------|
| `cloudinary` (via multer-storage-cloudinary) | high | Breaking upgrade to cloudinary@2.x required (`--force`). Public IDs validated before delete; only authenticated hosts upload. Plan cloudinary v2 migration. |
| `exceljs` / nested `uuid` | moderate | Export jobs only; not public unauthenticated. Avoid `npm audit fix --force` (downgrades exceljs). |

## App-level controls that reduce exploitability

- Auth required for export/upload/socket private rooms
- Rate limiting on auth and payment endpoints
- CSRF on cookie-authenticated mutations
- Webhook raw-body + signature verification
- Feature flags fail closed for passkeys / mock payments

## Operator checklist

```bash
npm ci
npm run audit:prod
npm test
npm run build:css
npm run lint:security-ui
```
