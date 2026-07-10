# Migrations & rollback

## Policy

- Prefer **backward-compatible** schema changes (add fields optional, new indexes non-blocking).
- Never drop columns/collections without a sunset period.
- Provide dry-run before apply.

## Commands

```bash
# Canonical field migration (existing)
npm run migrate:fields

# Finance reconcile (ledger vs projection)
npm run reconcile:finance -- --dry-run
npm run reconcile:finance -- --apply --confirm=YES

# Indexes verify (read-only list)
npm run indexes:verify
```

## Security / finance schema notes (post-P0/P1)

| Collection | Notable fields / indexes |
|---|---|
| `webauthn_challenges` | `ChallengeHash` + purpose/user/consumed; TTL on `ExpiresAt` |
| `user_sessions` | unique `Sid`; `UserID` + `RevokedAt` / `ExpiresAt` |
| `staff_members` | `AllBranches` (empty BranchIDs no longer means all) |
| `api_keys` | `AllBranches` |
| `webhook_events` | unique `(Provider, ProviderEventID)`; lease fields |
| `host_balances` | unique `HostID` |
| `refund_allocations` | unique `(RefundID, PaymentID)` |
| `host_profiles` | `IcalTokenHash` / revoke / expiry |
| `recurring_series` | sparse unique `IdempotencyKey`, `Timezone` |
| `background_jobs` | `LeaseUntil` for stuck recovery |

App models create indexes on boot/`syncIndexes`. Prefer rolling deploy: add fields optional first.

## Rollback plan template

1. Deploy previous app version (git tag / previous image).
2. If migration added fields: leave fields in place (compatible).
3. If migration wrote data: restore from backup taken pre-migration.
4. Re-run `reconcile:finance --dry-run` and smoke checklist.

## Dead code / deprecated routes

- Document sunset in release notes.
- Remove routes only after clients migrate (partner API versioning).
- Field lowercase renames: dual-read then dual-write then drop — never big-bang.
