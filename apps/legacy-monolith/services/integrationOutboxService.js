"use strict";

const crypto = require("crypto");
const IntegrationOutboxEvent = require("../models/IntegrationOutboxEvent");
const { validateEvent } = require("@workhub/contracts");
const { messaging } = require("@workhub/observability");
const { context, trace } = require("@opentelemetry/api");

/**
 * Enqueue a domain/integration event to the outbox database.
 * Runs atomically inside the provided Mongoose transaction session.
 */
async function enqueue(eventType, aggregateId, payload, options = {}) {
  const session = options.session;
  const correlationId = options.correlationId || crypto.randomUUID();
  const causationId = options.causationId || null;
  const eventId = options.eventId || crypto.randomUUID();

  // Get active OpenTelemetry trace ID
  const activeSpan = trace.getSpan(context.active());
  const traceId = activeSpan ? activeSpan.spanContext().traceId : null;

  // Aggregate version
  const aggregateVersion = options.aggregateVersion !== undefined ? options.aggregateVersion : 1;

  // Build versioned event envelope matching EventEnvelopeSchema
  const envelope = {
    eventId,
    eventType,
    occurredAt: new Date().toISOString(),
    producer: options.producer || "legacy-monolith",
    aggregateId: String(aggregateId),
    aggregateVersion,
    correlationId,
    causationId: options.causationId || undefined,
    traceId: traceId || undefined,
    data: payload,
  };

  // Pre-validate event schema contract
  validateEvent(envelope);

  // Save to database
  const [doc] = await IntegrationOutboxEvent.create(
    [
      {
        EventID: eventId,
        EventType: eventType,
        AggregateID: String(aggregateId),
        AggregateVersion: aggregateVersion,
        CorrelationID: correlationId,
        CausationID: causationId,
        TraceID: traceId,
        Payload: payload,
        Status: "pending",
        AvailableAt: new Date(),
      },
    ],
    { session }
  );

  return doc;
}

/**
 * Claim a batch of pending events using lease locks.
 */
async function claimBatch({ workerId, limit = 10, leaseMs = 30000 }) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);

  const claimed = [];

  // Find and update individually to secure lease locks under lock conditions
  let count = 0;
  while (count < limit) {
    const doc = await IntegrationOutboxEvent.findOneAndUpdate(
      {
        $or: [
          { Status: "pending", AvailableAt: { $lte: now } },
          { Status: "failed", AvailableAt: { $lte: now } },
          { Status: "processing", LeaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          Status: "processing",
          ProcessingBy: workerId,
          LeaseUntil: leaseUntil,
        },
        $inc: { Attempts: 1 },
      },
      {
        new: true,
        sort: { AvailableAt: 1 },
      }
    );

    if (!doc) break;
    claimed.push(doc);
    count++;
  }

  return claimed;
}

/**
 * Process pending outbox events and publish them to RabbitMQ.
 */
async function processPending(channel, workerId = `worker-${crypto.randomUUID()}`) {
  const batch = await claimBatch({ workerId, limit: 10 });
  if (batch.length === 0) return 0;

  let publishedCount = 0;

  for (const eventDoc of batch) {
    try {
      // Build envelope for publication
      const envelope = {
        eventId: eventDoc.EventID,
        eventType: eventDoc.EventType,
        occurredAt: eventDoc.createdAt ? eventDoc.createdAt.toISOString() : new Date().toISOString(),
        producer: "legacy-monolith",
        aggregateId: eventDoc.AggregateID,
        aggregateVersion: eventDoc.AggregateVersion,
        correlationId: eventDoc.CorrelationID,
        causationId: eventDoc.CausationID || undefined,
        traceId: eventDoc.TraceID || undefined,
        data: eventDoc.Payload,
      };

      // Wrap in publisher trace context if trace ID exists
      let contextToUse = context.active();
      if (eventDoc.TraceID) {
        // If a trace ID was persisted, create a span context matching it
        const spanContext = {
          traceId: eventDoc.TraceID,
          spanId: crypto.randomBytes(8).toString("hex"),
          traceFlags: 1, // IS_SAMPLED
        };
        const parentSpan = trace.wrapSpanContext(spanContext);
        contextToUse = trace.setSpan(context.active(), parentSpan);
      }

      await context.with(contextToUse, async () => {
        // Publish via our shared messaging utility
        await messaging.publishEvent(channel, envelope);
      });

      // Update state upon confirm success
      eventDoc.Status = "published";
      eventDoc.LastError = null;
      await eventDoc.save();

      publishedCount++;
    } catch (err) {
      console.error(`[OutboxPublisher] Failed to publish event ${eventDoc.EventID}:`, err.message);

      // Apply exponential backoff delay for retries
      const nextDelayMs = Math.min(1000 * Math.pow(2, eventDoc.Attempts), 3600000); // Max 1 hour
      eventDoc.AvailableAt = new Date(Date.now() + nextDelayMs);

      if (eventDoc.Attempts >= 5) {
        eventDoc.Status = "dead";
      } else {
        eventDoc.Status = "failed";
      }
      eventDoc.LastError = err.message;
      await eventDoc.save();
    }
  }

  return publishedCount;
}

module.exports = {
  enqueue,
  claimBatch,
  processPending,
};
