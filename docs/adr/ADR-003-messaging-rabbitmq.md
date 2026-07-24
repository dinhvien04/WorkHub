# ADR-003: Messaging Infrastructure via RabbitMQ

## Context
Microservices need to propagate side effects and publish state updates asynchronously.

## Decision
We select RabbitMQ as the central message broker.
Communication will use durable queues/exchanges with manual acknowledgements.
Events will use a standardized JSON wrapper containing trace identifiers, routing metadata, schema versioning, and correlation/causation IDs.

## Consequences
- Guaranteed message persistence and delivery safety.
- Dead-letter queues (DLQ) will capture failing consumer requests for manual resolution/replay.
