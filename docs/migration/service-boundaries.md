# Service Boundaries Definition

This document maps out the targeted microservices, their bounded contexts, and the capabilities they will own post-migration.

## Microservices Catalog

### 1. Identity Service (Bounded Context: Authentication & Authorization)
- **Capabilities:** User identity management, session management, WebAuthn/2FA registration and login, password resets, role management.
- **Database:** `workhub_identity`

### 2. Catalog Service (Bounded Context: Coworking Spaces and Listing Data)
- **Capabilities:** Space and branch creation/updating, reviews and ratings average projections, amenities, search indices.
- **Database:** `workhub_catalog`

### 3. Booking Service (Bounded Context: Space Reservations & Operations)
- **Capabilities:** Booking slots reservations, check-in/check-out flows, booking status state machine, incident reports, notes history.
- **Database:** `workhub_booking`

### 4. Billing Service (Bounded Context: Payments & Ledgers)
- **Capabilities:** Pricing rules calculation, coupon validation, payment capture via providers, payouts, ledger accounting.
- **Database:** `workhub_billing`

### 5. Communication Service (Bounded Context: Delivery & Subscriptions)
- **Capabilities:** Web push subscription registrations, user-agent verification, push/email dispatch.
- **Database:** `workhub_communication`

### 6. Content Service (Bounded Context: CMS & SEO Assets)
- **Capabilities:** SEO redirections, sitemap aggregation, CMS content management.
- **Database:** `workhub_content`

### 7. Operations Service (Bounded Context: Audits & DLQ Management)
- **Capabilities:** Outbox dead-letter queues, dispute resolution orchestration, audit metrics.
- **Database:** `workhub_operations`
