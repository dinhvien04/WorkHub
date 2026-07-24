# Event Catalog

This document defines event schemas and pub/sub interfaces for asynchronous communication between the microservices.

## Inter-Service Message Catalog

### 1. Catalog Domain Events
- **`catalog.review-created.v1`**: Published when a review is submitted by a customer.
  - *Payload:* `{ reviewId: string, spaceId: string, rating: number }`
- **`catalog.rating-recalculated.v1`**: Published when branch/space average rating updates.
  - *Payload:* `{ spaceId: string, ratingAvg: number }`

### 2. Booking Domain Events
- **`booking.hold-created.v1`**: Enqueued when slots are reserved and hold period starts.
  - *Payload:* `{ bookingId: string, spaceId: string, depositAmount: number, expiresAt: string }`
- **`booking.confirmed.v1`**: Enqueued when booking hold is completed via billing.
  - *Payload:* `{ bookingId: string, spaceId: string, paidAmount: number }`

### 3. Billing Domain Events
- **`billing.payment-succeeded.v1`**: Triggered when client payment transaction captures successfully.
  - *Payload:* `{ bookingId: string, amount: number, paymentId: string }`
- **`billing.refund-completed.v1`**: Triggered when a manual/provider refund completes settling.
  - *Payload:* `{ refundId: string, bookingId: string, refundAmount: number }`
