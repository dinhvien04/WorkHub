# Operations security & environments

## Secrets

- Store `JWT_SECRET`, `GATEWAY_WEBHOOK_SECRET`, payment keys, Cloudinary secrets in a **secrets manager** (AWS SM, GCP SM, Doppler, Vault).
- Rotate JWT and webhook secrets with dual-read window; bump `tokenVersion` or invalidate sessions on JWT rotation.
- Least privilege: app DB user read/write app DB only; no clusterAdmin.
- Never log secrets, cookies, OTPs, bank numbers (audit redaction enforced in `utils/auditLogger.js`).

## TLS / network

- MongoDB: require TLS in production (`tls=true` / Atlas).
- Restrict DB network to app subnets / private endpoints.
- Encrypt backups at rest; test restore quarterly:

```bash
# example restore drill (document actual procedure for your host)
mongorestore --uri "$MONGODB_URI" --drop ./backup-dir
npm run reconcile:finance -- --dry-run
```

## Environments

| Env | Purpose |
|-----|---------|
| development | Local; mock payments allowed |
| test | Jest memory Mongo |
| staging | Prod-like; real providers sandbox keys |
| production | Live; mock payments forbidden |

Set distinct `MONGODB_URI`, `PUBLIC_BASE_URL`, secrets per env. Never share production secrets with staging.

## CDN / compression

- Terminate TLS at reverse proxy/CDN.
- Enable **Brotli** with gzip fallback for `text/*`, `application/javascript`, `application/json`.
- Cache hashed `/dist/*` with `public, max-age=31536000, immutable`.
- See `deploy/nginx.conf.example`.
