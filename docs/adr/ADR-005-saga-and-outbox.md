# ADR-005: Saga Orchestration and Transactional Outbox

## Context
With independent databases, standard database transactions cannot span across services. We must maintain eventual consistency for multi-service operations (such as Booking-Payment and Dispute-Refund).

## Decision
We enforce two patterns:
1. **Transactional Outbox:** Any side-effects or events are written as `OutboxEvent` documents in the same database transaction as the business entity update, ensuring atomic delivery.
2. **Saga Orchestration:** Events published via outbox will trigger compensating steps or subsequent steps across other services (e.g. `billing.refund-completed.v1` updates Dispute status to resolved).

## Consequences
- Guarantees eventual consistency without using expensive distributed transactions.
- Provides resilient and retriable transactional flows.
