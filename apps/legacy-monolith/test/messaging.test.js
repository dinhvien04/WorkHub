"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_key_at_least_32_characters_long_for_workhub";

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { AsyncLocalStorage } = require("async_hooks");
const IntegrationOutboxEvent = require("../models/IntegrationOutboxEvent");
const InboxMessage = require("../models/InboxMessage");
const ConsumerDeadLetter = require("../models/ConsumerDeadLetter");
const integrationOutboxService = require("../services/integrationOutboxService");
const inboxService = require("../services/inboxService");
const { messaging, getTracer } = require("@workhub/observability");
const { context, trace, propagation, ROOT_CONTEXT } = require("@opentelemetry/api");

let replset;

// 1. Custom Propagator for TraceContext propagation testing
class TestPropagator {
  inject(ctx, carrier, setter) {
    const span = trace.getSpan(ctx);
    if (span && span.spanContext) {
      const sc = span.spanContext();
      setter.set(carrier, "traceparent", `00-${sc.traceId}-${sc.spanId}-01`);
    }
  }

  extract(ctx, carrier, getter) {
    const traceparent = getter.get(carrier, "traceparent");
    if (traceparent) {
      const parts = traceparent.split("-");
      if (parts.length === 4) {
        return trace.setSpanContext(ctx, {
          traceId: parts[1],
          spanId: parts[2],
          traceFlags: Number(parts[3]),
        });
      }
    }
    return ctx;
  }

  fields() {
    return ["traceparent"];
  }
}

// 2. Custom Context Manager using AsyncLocalStorage
class TestContextManager {
  constructor() {
    this._storage = new AsyncLocalStorage();
  }

  active() {
    return this._storage.getStore() || ROOT_CONTEXT;
  }

  with(ctx, fn, thisArg, ...args) {
    return this._storage.run(ctx, () => fn.call(thisArg, ...args));
  }

  bind(ctx, target) {
    return target;
  }

  enable() {
    return this;
  }

  disable() {
    return this;
  }
}

// Register OpenTelemetry global services for propagation tests
propagation.setGlobalPropagator(new TestPropagator());
context.setGlobalContextManager(new TestContextManager().enable());

// Set high timeout since replica set startup can take time
jest.setTimeout(180000);

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  const uri = replset.getUri();
  process.env.MONGODB_URI = uri;

  await mongoose.connect(uri);

  // Assert collections exist
  await IntegrationOutboxEvent.createCollection();
  await InboxMessage.createCollection();
  await ConsumerDeadLetter.createCollection();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) {
    await replset.stop();
  }
});

beforeEach(async () => {
  // Clear collections
  await IntegrationOutboxEvent.deleteMany({});
  await InboxMessage.deleteMany({});
  await ConsumerDeadLetter.deleteMany({});
});

/**
 * High-fidelity Mock Confirm Channel supporting confirms, DLX routing, prefetch, and validation callbacks.
 */
class TestMockConfirmChannel {
  constructor() {
    this.queues = {};
    this.published = [];
    this.acked = [];
    this.rejected = [];
    this.consumers = {};
    this.confirmSuccess = true;
    this.confirmError = null;
  }

  async assertExchange() {
    return { exchange: "workhub.events" };
  }

  async assertQueue(queue) {
    if (!this.queues[queue]) {
      this.queues[queue] = { messages: [] };
    }
    return { queue };
  }

  async bindQueue() {
    return true;
  }

  async prefetch() {
    return true;
  }

  publish(exchange, routingKey, content, options = {}, callback) {
    const payload = JSON.parse(content.toString());
    const messageId = options.messageId || `msg-${Date.now()}`;

    const amqpMsg = {
      fields: { routingKey, deliveryTag: this.published.length + 1 },
      properties: {
        messageId,
        timestamp: options.timestamp || Date.now(),
        headers: options.headers || {},
      },
      content: content,
    };

    this.published.push({
      exchange,
      routingKey,
      payload,
      options,
      amqpMsg,
    });

    // Simulate Publisher Confirms
    if (callback) {
      if (this.confirmSuccess) {
        callback(null, true);
      } else {
        callback(this.confirmError || new Error("Nack from broker"), false);
      }
    }

    return true;
  }

  async consume(queue, callback, options = {}) {
    this.consumers[queue] = { callback, options };
    return { consumerTag: `tag-${queue}` };
  }

  ack(msg) {
    this.acked.push(msg);
  }

  reject(msg, requeue = true) {
    this.rejected.push({ msg, requeue });
  }
}

describe("Phase M3 Messaging Foundation Integration & Crash Recovery Tests", () => {

  test("1. DB Commit succeeds but publisher has not run", async () => {
    const session = await mongoose.startSession();
    session.startTransaction();

    let doc;
    try {
      doc = await integrationOutboxService.enqueue(
        "catalog.review-created.v1",
        "aggregate-123",
        { reviewId: "rev-456", spaceId: "d3b07384-d113-4886-a511-2b02a2e0a2c1", rating: 5 },
        { session }
      );
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    // Verify written to database in pending status
    const saved = await IntegrationOutboxEvent.findById(doc._id);
    expect(saved).toBeTruthy();
    expect(saved.Status).toBe("pending");

    // Broker channel should have received no publishes yet
    const channel = new TestMockConfirmChannel();
    expect(channel.published.length).toBe(0);
  });

  test("2. Publisher executes successfully and processes pending events", async () => {
    // Enqueue an event
    const doc = await integrationOutboxService.enqueue(
      "catalog.review-created.v1",
      "aggregate-123",
      { reviewId: "rev-456", spaceId: "d3b07384-d113-4886-a511-2b02a2e0a2c1", rating: 5 }
    );

    const channel = new TestMockConfirmChannel();

    // Run pending processor
    const count = await integrationOutboxService.processPending(channel);
    expect(count).toBe(1);

    // Verify broker received publication
    expect(channel.published.length).toBe(1);
    const pub = channel.published[0];
    expect(pub.routingKey).toBe("catalog.review-created.v1");
    expect(pub.payload.aggregateId).toBe("aggregate-123");
    expect(pub.payload.data.reviewId).toBe("rev-456");

    // Verify outbox database status updated to published
    const updated = await IntegrationOutboxEvent.findById(doc._id);
    expect(updated.Status).toBe("published");
  });

  test("3. Duplicate event deduplication logic (Inbox Pattern)", async () => {
    const eventId = "d3b07384-d113-4886-a511-2b02a2e0a2c3";
    const consumerName = "billing-service";
    let executeCount = 0;

    const handlerCallback = async (session) => {
      executeCount++;
      return { ok: true };
    };

    // First attempt -> processes successfully
    const result1 = await inboxService.processIdempotent(eventId, consumerName, handlerCallback);
    expect(result1.status).toBe("processed");
    expect(executeCount).toBe(1);

    // Second attempt (duplicate delivery) -> skipped
    const result2 = await inboxService.processIdempotent(eventId, consumerName, handlerCallback);
    expect(result2.status).toBe("skipped");
    expect(result2.reason).toBe("already_processed");
    expect(executeCount).toBe(1); // Call count remains 1
  });

  test("4 & 5. Consumer crash recovery: crash before ack and redelivery deduplication", async () => {
    const channel = new TestMockConfirmChannel();
    const queueName = "booking-queue";
    let handlerExecutedCount = 0;

    const eventId = "d3b07384-d113-4886-a511-2b02a2e0a2c4";
    const correlationId = "d3b07384-d113-4886-a511-2b02a2e0a2c5";

    // Build standard envelope
    const envelope = {
      eventId: eventId,
      eventType: "billing.payment-succeeded.v1",
      occurredAt: new Date().toISOString(),
      producer: "legacy-monolith",
      aggregateId: "agg-payment-001",
      aggregateVersion: 1,
      correlationId: correlationId,
      data: { paymentId: "pay-101", bookingId: "d3b07384-d113-4886-a511-2b02a2e0a2c6", amount: 150000 },
    };

    // Stub handler that simulates a processing crash by throwing an error *before* acking
    const handler = async (event, msg) => {
      // Execute within idempotent processor
      await inboxService.processIdempotent(event.eventId, queueName, async (session) => {
        handlerExecutedCount++;
        // Simulate successful business state commits first
      });

      // Simulate crash right here
      throw new Error("Consumer crashed unexpectedly!");
    };

    // Configure subscription
    await messaging.subscribeEvent(channel, {
      queueName,
      routingKeyPattern: "billing.payment-succeeded.v1",
      handler,
      onDeadLetter: inboxService.logDeadLetter,
    });

    // Simulate broker publishing the message first time
    const rawContent = Buffer.from(JSON.stringify(envelope));
    const msg1 = {
      fields: { routingKey: "billing.payment-succeeded.v1", deliveryTag: 1 },
      properties: { messageId: envelope.eventId, headers: { "x-retry-count": 0 } },
      content: rawContent,
    };

    // Fire consumer callback (First delivery)
    const consumer = channel.consumers[queueName];
    await consumer.callback(msg1);

    // Assert that the business logic was executed
    expect(handlerExecutedCount).toBe(1);

    // Assert that it was published to the retry queue with x-retry-count incremented
    expect(channel.published.length).toBe(1);
    const retryPub = channel.published[0];
    expect(retryPub.exchange).toBe("workhub.events.retry");
    expect(retryPub.routingKey).toBe("booking-queue.retry");
    expect(retryPub.options.headers["x-retry-count"]).toBe(1);
    expect(retryPub.options.headers["x-original-error"]).toBe("Consumer crashed unexpectedly!");

    // Verify that the wrapper acked msg1 on the main queue to complete the retry handoff
    expect(channel.acked.length).toBe(1);

    // The message is put into the retry queue by subscribeEvent wrapper and acked/nacked.
    // In our test, we will verify redelivery handling.
    // Simulate broker redelivering the message again (representing retry deliveryTag 2)
    const msg2 = {
      fields: { routingKey: "billing.payment-succeeded.v1", deliveryTag: 2, redelivered: true },
      properties: { messageId: envelope.eventId, headers: { "x-retry-count": 1 } },
      content: rawContent,
    };

    // Set up a clean handler that acts like redelivery processing
    const redeliveryHandler = async (event, msg) => {
      const res = await inboxService.processIdempotent(event.eventId, queueName, async (session) => {
        handlerExecutedCount++;
      });
      if (res.status === "skipped") {
        // Deduped successfully
        return;
      }
    };

    const redeliverChannel = new TestMockConfirmChannel();
    await messaging.subscribeEvent(redeliverChannel, {
      queueName,
      routingKeyPattern: "billing.payment-succeeded.v1",
      handler: redeliveryHandler,
      onDeadLetter: inboxService.logDeadLetter,
    });

    // Fire consumer callback (Second delivery)
    const redeliverConsumer = redeliverChannel.consumers[queueName];
    await redeliverConsumer.callback(msg2);

    // Business execution should still be 1 (deduplicated!)
    expect(handlerExecutedCount).toBe(1);
    // Verify that the redelivery channel successfully acked the duplicate message
    expect(redeliverChannel.acked.length).toBe(1);
  });

  test("6. Poison message validation violation routes to DLQ", async () => {
    const channel = new TestMockConfirmChannel();
    const queueName = "catalog-queue";
    let handlerCalled = false;

    // Build non-conforming poison payload (missing aggregateId, correlationId, etc.)
    const poisonPayload = {
      eventId: "d3b07384-d113-4886-a511-2b02a2e0a2cf",
      eventType: "catalog.review-created.v1",
      // missing fields (occurredAt, correlationId, data.spaceId etc.)
      data: { reviewId: "rev-666" },
    };

    const handler = async () => {
      handlerCalled = true;
    };

    await messaging.subscribeEvent(channel, {
      queueName,
      routingKeyPattern: "catalog.review-created.v1",
      handler,
      onDeadLetter: inboxService.logDeadLetter,
    });

    const rawContent = Buffer.from(JSON.stringify(poisonPayload));
    const msg = {
      fields: { routingKey: "catalog.review-created.v1", deliveryTag: 1 },
      properties: { messageId: poisonPayload.eventId, headers: {} },
      content: rawContent,
    };

    // Fire consumer callback
    const consumer = channel.consumers[queueName];
    await consumer.callback(msg);

    // Business handler should NOT be called
    expect(handlerCalled).toBe(false);
    // Message should be rejected (routed to DLQ)
    expect(channel.rejected.length).toBe(1);
    expect(channel.rejected[0].requeue).toBe(false);

    // Verify DLQ log saved to database
    const dlqLog = await ConsumerDeadLetter.findOne({ MessageID: poisonPayload.eventId });
    expect(dlqLog).toBeTruthy();
    expect(dlqLog.Error).toContain("Schema Validation Failed");
  });

  test("7. Publisher confirms: handle confirm success and failure states", async () => {
    // 7a. Confirm Success
    const docSuccess = await integrationOutboxService.enqueue(
      "catalog.review-created.v1",
      "agg-success",
      { reviewId: "rev-777", spaceId: "d3b07384-d113-4886-a511-2b02a2e0a2c7", rating: 5 }
    );
    const channelSuccess = new TestMockConfirmChannel();
    channelSuccess.confirmSuccess = true;

    await integrationOutboxService.processPending(channelSuccess);
    const updatedSuccess = await IntegrationOutboxEvent.findById(docSuccess._id);
    expect(updatedSuccess.Status).toBe("published");

    // 7b. Confirm Failure
    const docFail = await integrationOutboxService.enqueue(
      "catalog.review-created.v1",
      "agg-fail",
      { reviewId: "rev-888", spaceId: "d3b07384-d113-4886-a511-2b02a2e0a2c8", rating: 4 }
    );
    const channelFail = new TestMockConfirmChannel();
    channelFail.confirmSuccess = false;
    channelFail.confirmError = new Error("Broker disk full");

    await integrationOutboxService.processPending(channelFail);
    const updatedFail = await IntegrationOutboxEvent.findById(docFail._id);
    expect(updatedFail.Status).toBe("failed"); // Retried / failed state
    expect(updatedFail.LastError).toBe("Broker disk full");
  });

  test("8. Trace ID and Correlation ID propagated across publish and consume", async () => {
    const channel = new TestMockConfirmChannel();
    const tracer = getTracer("test-tracer");

    // Create a mock active trace context
    const spanContext = {
      traceId: "d4b4a1b020a2e0a2ca2cb07d5c9db02e",
      spanId: "c01d2c3b4a5f6e7d",
      traceFlags: 1,
    };
    const parentSpan = trace.wrapSpanContext(spanContext);
    const mockContext = trace.setSpan(context.active(), parentSpan);

    let publishedEvent;

    // Publish within active mock context
    await context.with(mockContext, async () => {
      publishedEvent = await integrationOutboxService.enqueue(
        "catalog.review-created.v1",
        "agg-trace-123",
        { reviewId: "rev-999", spaceId: "d3b07384-d113-4886-a511-2b02a2e0a2c9", rating: 5 }
      );
      await integrationOutboxService.processPending(channel);
    });

    expect(channel.published.length).toBe(1);
    const pub = channel.published[0];

    // Assert traceparent propagation header is injected
    expect(pub.options.headers).toHaveProperty("traceparent");
    expect(pub.options.headers.traceparent).toContain("d4b4a1b020a2e0a2ca2cb07d5c9db02e");

    // Simulate consumer consuming event and check propagation
    let consumerTraceId;
    const consumerName = "trace-consumer";

    const handler = async (event) => {
      // Inside consumer span context, retrieve trace info
      const currentSpan = trace.getSpan(context.active());
      if (currentSpan) {
        consumerTraceId = currentSpan.spanContext().traceId;
      }
    };

    await messaging.subscribeEvent(channel, {
      queueName: "trace-queue",
      routingKeyPattern: "catalog.review-created.v1",
      handler,
    });

    const consumer = channel.consumers["trace-queue"];
    await consumer.callback(pub.amqpMsg);

    // Verify trace ID in consumer matches publisher parent span
    expect(consumerTraceId).toBe("d4b4a1b020a2e0a2ca2cb07d5c9db02e");
    // Verify correlation ID propagated correctly
    expect(pub.payload.correlationId).toBe(publishedEvent.CorrelationID);
  });
});
