# Dependency Risk Register

This document registers known dependencies vulnerabilities, their production reachability, and accepted risks.

---

## Vulnerabilities Register

### 1. brace-expansion / minimatch / glob / rimraf
* **Severity**: High
* **CVE/Advisory**: [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
* **Path**: `exceljs` -> `archiver` -> `archiver-utils` -> `glob` -> `minimatch` -> `brace-expansion`
* **Production Reachability**: Low. Only used in admin reporting routes (Excel export of ledger/bookings), not accessible to unauthenticated edge requests.
* **Patched Version**: `brace-expansion@2.0.1` / `minimatch@5.0.0` / `glob@9.0.0` / `rimraf@4.0.0`
* **Accepted Risk Reason**: Upgrading `exceljs` to resolve this would require major semver upgrades, risking breaking changes in excel generation formats. Since the export feature is restricted to verified admins and has rate limits, the risk is accepted.
* **Expiration Date**: 2027-07-24 (1 year review period)
* **Owner**: Security Team

### 2. mongoose (Prototype Pollution)
* **Severity**: Moderate
* **CVE/Advisory**: [GHSA-664h-wqgq-64gw](https://github.com/advisories/GHSA-664h-wqgq-64gw)
* **Path**: `mongoose`
* **Production Reachability**: High. Handles all database writes and updates.
* **Patched Version**: `mongoose@8.1.1` or `8.2.0` or later.
* **Fix/Mitigation**: Input payloads are strongly validated at the gateway and service controller levels using schema validators (Zod and Mongoose Schema validation properties) before hitting document casts.
* **Accepted Risk Reason**: Accepted temporarily while the workspaces transition to microservices where mongoose versions are updated incrementally.
* **Expiration Date**: 2026-10-24 (3 months review period)
* **Owner**: Backend Team
