# ADR-002: Service Boundaries Definition

## Context
To prevent a distributed monolith pattern, we need clear boundaries for microservices, delineating which service holds the authoritative state for different contexts.

## Decision
We define 7 microservices with strict domain boundaries:
1. **Identity:** Auth, credentials, sessions, roles, TOTP, WebAuthn.
2. **Catalog:** Host profile, branch, space details, reviews/ratings, search.
3. **Booking:** Bookings, slots locking, reception check-in, timeline events, incidents.
4. **Billing:** Quotes, pricing, payments, refunds, payouts, financial ledger.
5. **Communication:** Push subscriptions, notification logs, email delivery.
6. **Content:** CMS pages, SEO redirects, sitemaps.
7. **Operations:** Dispute cases orchestration, dead-letter audits, reconciliation metrics.

## Consequences
- Service logic remains decoupled.
- Data structures are owned by their respective services (no shared databases).
