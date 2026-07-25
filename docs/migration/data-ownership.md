# Data Ownership & Database Isolation Map

This document establishes database segregation boundaries, mapping legacy models to their isolated microservice databases.

## Schema Partitioning Map

| Legacy Model | Target Database | Service Owner | Read/Write Policy |
| --- | --- | --- | --- |
| `User`, `HostProfile`, `CustomerProfile` | `workhub_identity` | Identity Service | Only Identity Service can modify credentials and user profile info. |
| `Branch`, `Space`, `Review` | `workhub_catalog` | Catalog Service | Branch/Space listings are modified by Catalog. Space schema holds booking policies. |
| `Booking`, `BookingSlot`, `Incident` | `workhub_booking` | Booking Service | Booking owns reservation statuses, check-ins, and slot-locking validation. |
| `PaymentHistory`, `Refund`, `RefundAllocation`, `LedgerEntry` | `workhub_billing` | Billing Service | Billing manages transaction logs, payouts, and balances. |
| `PushSubscription`, `Notification` | `workhub_communication` | Communication Service | Subscriptions and notification payloads. |
| `CmsPage`, `SeoRedirect` | `workhub_content` | Content Service | Static sitemaps and localized pages. |
| `Dispute` | `workhub_operations` | Operations Service | Dispute case management and resolution tracks. |
