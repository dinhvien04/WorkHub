# ADR-004: Database Per Service

## Context
Shared databases form tight coupling between services and lead to schema management conflicts and scaling bottlenecks.

## Decision
We enforce a strict "Database Per Service" pattern.
Each microservice owns its MongoDB database (e.g. `workhub_identity`, `workhub_booking`) and its credentials. Direct cross-database queries or populatings from foreign collections are strictly prohibited. Local read-only replicas/snapshots will be synchronized via messaging where necessary.

## Consequences
- Total data isolation between domain modules.
- Independent schema migrations and scalability capabilities per service.
