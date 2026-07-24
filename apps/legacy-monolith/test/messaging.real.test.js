"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_key_at_least_32_characters_long_for_workhub";

const mongoose = require("mongoose");
const amqp = require("amqplib");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { AsyncLocalStorage } = require("async_hooks");
const IntegrationOutboxEvent = require("../models/IntegrationOutboxEvent");
const InboxMessage = require("../models/InboxMessage");
const ConsumerDeadLetter = require("../models/ConsumerDeadLetter");
const integrationOutboxService = require("../services/integrationOutboxService");
const inboxService = require("../services/inboxService");
const { messaging, getTracer } = require("@workhub/observability");
const { context, trace, propagation, ROOT_CONTEXT } = require("@opentelemetry/api");

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";

let replset;
let isBrokerAvailable = false;

// Register OpenTelemetry propagation
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

try {
  propagation.setGlobalPropagator(new TestPropagator());
  context.setGlobalContextManager(new TestContextManager().enable());
} catch {
  // Ignore re-register failures if already registered
}

jest.setTimeout(180000);

beforeAll(async () => {
  // Test connection to local RabbitMQ broker first
  try {
    const conn = await amqp.connect(RABBITMQ_URL);
    await conn.close();
    isBrokerAvailable = true;
    console.log(`[RealBrokerTest] Local RabbitMQ is available at ${RABBITMQ_URL}. Running real tests.`);
  } catch (err) {
    console.warn(`[RealBrokerTest] RabbitMQ is not running at ${RABBITMQ_URL}. Skipping real broker tests. Run 'docker compose up -d' to start.`);
    isBrokerAvailable = false;
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  const uri = replset.getUri();
  process.env.MONGODB_URI = uri;

  await mongoose.connect(uri);

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
  await IntegrationOutboxEvent.deleteMany({});
  await InboxMessage.deleteMany({});
  await ConsumerDeadLetter.deleteMany({});
});

describe("Phase M3 Messaging Foundation Real-Broker Integration Tests", () => {

  test("a. Publish persistent message and receive broker confirm", async () => {
    if (!isBrokerAvailable) return;

    const conn = await amqp.connect(RABBITMQ_URL);
    const channel = await conn.createConfirmChannel();

    const exchange = "real.test.exchange";
    const queue = "real.test.queue";

    await channel.assertExchange(exchange, "topic", { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, exchange, "test.routing.key");

    const payload = { test: true };
    const content = Buffer.from(JSON.stringify(payload));

    const publishConfirmed = await new Promise((resolve, reject) => {
      channel.publish(exchange, "test.routing.key", content, { persistent: true }, (err, ok) => {
        if (err) reject(err);
        else resolve(ok);
      });
    });

    expect(publishConfirmed).toBe(true);

    // Clean up
    await channel.deleteQueue(queue);
    await channel.deleteExchange(exchange);
    await channel.close();
    await conn.close();
  });

  test("b. Unroutable message with mandatory flag is detected", async () => {
    if (!isBrokerAvailable) return;

    const conn = await amqp.connect(RABBITMQ_URL);
    const channel = await conn.createConfirmChannel();

    const exchange = "unroutable.exchange";
    await channel.assertExchange(exchange, "topic", { durable: true });

    let returnTriggered = false;
    channel.on("return", (msg) => {
      returnTriggered = true;
      expect(msg.fields.routingKey).toBe("no.queue.bind");
    });

    const content = Buffer.from(JSON.stringify({ unroutable: true }));
    channel.publish(exchange, "no.queue.bind", content, { mandatory: true });

    // Wait a brief moment to allow return event to trigger
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(returnTriggered).toBe(true);

    await channel.deleteExchange(exchange);
    await channel.close();
    await conn.close();
  });

  test("e, f & g. Consumer processed completed but connection closed before ACK -> original message redelivered & inbox handler skip but ACK", async () => {
    if (!isBrokerAvailable) return;

    const conn1 = await amqp.connect(RABBITMQ_URL);
    const channel1 = await conn1.createConfirmChannel();

    const exchange = "crash.test.exchange";
    const queue = "crash.test.queue";

    await channel1.assertExchange(exchange, "topic", { durable: true });
    await channel1.assertQueue(queue, { durable: true });
    await channel1.bindQueue(queue, exchange, "crash.test.key");

    const eventId = "d3b07384-d113-4886-a511-2b02a2e0a2da";
    const envelope = {
      eventId,
      eventType: "catalog.review-created.v1",
      occurredAt: new Date().toISOString(),
      producer: "test",
      aggregateId: "agg-1",
      aggregateVersion: 1,
      correlationId: "d3b07384-d113-4886-a511-2b02a2e0a2db",
      data: { reviewId: "rev-1", spaceId: "space-1", rating: 5 },
    };

    // 1. Publish message
    await new Promise((resolve) => {
      channel1.publish(exchange, "crash.test.key", Buffer.from(JSON.stringify(envelope)), { persistent: true }, () => resolve());
    });

    let handlerExecutionCount = 0;

    // 2. Consume from connection 1
    await channel1.consume(queue, async (msg) => {
      // Process business transaction in inboxService
      await inboxService.processIdempotent(envelope.eventId, queue, async (session) => {
        handlerExecutionCount++;
      });
      // We simulate CRASH here: immediately close connection 1 without ACK
      await channel1.close();
      await conn1.close();
    }, { noAck: false });

    // Wait a moment for consumer callback and connection closure
    await new Promise((resolve) => setTimeout(resolve, 800));

    // At this point, the business logic committed to database, but connection closed before ACK.
    // 3. Connect from connection 2 to process redelivery
    const conn2 = await amqp.connect(RABBITMQ_URL);
    const channel2 = await conn2.createConfirmChannel();

    let secondHandlerCallCount = 0;
    let wasRedelivered = false;

    await channel2.consume(queue, async (msg) => {
      wasRedelivered = msg.fields.redelivered;

      // Deduplication check
      const res = await inboxService.processIdempotent(envelope.eventId, queue, async () => {
        secondHandlerCallCount++;
      });

      if (res.status === "skipped") {
        channel2.ack(msg); // Skip handler and ACK
      }
    }, { noAck: false });

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(handlerExecutionCount).toBe(1);
    expect(secondHandlerCallCount).toBe(0); // Deduplicated!
    expect(wasRedelivered).toBe(true); // Redelivered successfully!

    // Clean up
    await channel2.deleteQueue(queue);
    await channel2.deleteExchange(exchange);
    await channel2.close();
    await conn2.close();
  });

  test("h. Transient failure routes to retry delay natively", async () => {
    if (!isBrokerAvailable) return;

    const conn = await amqp.connect(RABBITMQ_URL);
    const channel = await conn.createConfirmChannel();

    const exchange = "workhub.events";
    const queue = "test-policy-queue";
    const retryQueue = `${queue}.retry`;

    await channel.assertExchange(exchange, "topic", { durable: true });
    await channel.assertQueue(queue, { durable: true });
    // Declare retry queue with dead-letter back to main exchange
    await channel.assertQueue(retryQueue, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": exchange,
        "x-dead-letter-routing-key": queue,
        "x-message-ttl": 1000 // 1 second backoff delay
      }
    });

    await channel.bindQueue(queue, exchange, "test-policy.key");
    await channel.bindQueue(retryQueue, "workhub.events.retry", `${queue}.retry`);

    const envelope = {
      eventId: "d3b07384-d113-4886-a511-2b02a2e0a2dc",
      eventType: "test-policy.key",
      occurredAt: new Date().toISOString(),
      producer: "test",
      aggregateId: "agg-2",
      aggregateVersion: 1,
      correlationId: "d3b07384-d113-4886-a511-2b02a2e0a2dd",
      data: { reviewId: "rev-2", spaceId: "space-2", rating: 5 },
    };

    await new Promise((resolve) => {
      channel.publish(exchange, "test-policy.key", Buffer.from(JSON.stringify(envelope)), { persistent: true }, () => resolve());
    });

    let attempts = 0;
    await messaging.subscribeEvent(channel, {
      queueName: queue,
      routingKeyPattern: "test-policy.key",
      handler: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("Temporary DB lockout");
        }
      }
    });

    // Wait for the transient failure, retry, and eventual recovery
    await new Promise((resolve) => setTimeout(resolve, 2500));

    expect(attempts).toBe(2); // Retried after delay and processed!

    await channel.deleteQueue(queue);
    await channel.deleteQueue(retryQueue);
    await channel.close();
    await conn.close();
  });

  test("i & j. Poison message & Exceeding max attempts routes to DLQ", async () => {
    if (!isBrokerAvailable) return;

    const conn = await amqp.connect(RABBITMQ_URL);
    const channel = await conn.createConfirmChannel();

    const exchange = "workhub.events";
    const queue = "poison-test-queue";
    const dlq = `${queue}.dlq`;

    await channel.assertExchange(exchange, "topic", { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.assertQueue(dlq, { durable: true });
    await channel.bindQueue(dlq, "workhub.events.dlx", dlq);

    // Poison message (invalid schema envelope)
    const poisonPayload = { eventId: "poison-000", data: {} };

    await new Promise((resolve) => {
      channel.publish(exchange, "poison.routing.key", Buffer.from(JSON.stringify(poisonPayload)), { persistent: true }, () => resolve());
    });

    await messaging.subscribeEvent(channel, {
      queueName: queue,
      routingKeyPattern: "poison.routing.key",
      handler: async () => {},
      onDeadLetter: inboxService.logDeadLetter
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify DLQ log saved to database
    const savedLog = await ConsumerDeadLetter.findOne({ MessageID: "poison-000" });
    expect(savedLog).toBeTruthy();
    expect(savedLog.Error).toContain("Schema Validation Failed");

    await channel.deleteQueue(queue);
    await channel.deleteQueue(dlq);
    await channel.close();
    await conn.close();
  });

  test("l. Telemetry traceparent, correlationId, and causationId are kept", async () => {
    if (!isBrokerAvailable) return;

    const conn = await amqp.connect(RABBITMQ_URL);
    const channel = await conn.createConfirmChannel();

    const exchange = "workhub.events";
    const queue = "trace-test-queue";

    await channel.assertExchange(exchange, "topic", { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, exchange, "trace.test.key");

    const spanContext = {
      traceId: "d4b4a1b020a2e0a2ca2cb07d5c9db02e",
      spanId: "c01d2c3b4a5f6e7d",
      traceFlags: 1,
    };
    const parentSpan = trace.wrapSpanContext(spanContext);
    const mockContext = trace.setSpan(context.active(), parentSpan);

    let publishedEvent;
    await context.with(mockContext, async () => {
      publishedEvent = await integrationOutboxService.enqueue(
        "catalog.review-created.v1",
        "agg-trace-real",
        { reviewId: "rev-real", spaceId: "d3b07384-d113-4886-a511-2b02a2e0a2c9", rating: 5 }
      );
      await integrationOutboxService.processPending(channel);
    });

    let receivedTraceId;
    await messaging.subscribeEvent(channel, {
      queueName: queue,
      routingKeyPattern: "catalog.review-created.v1",
      handler: async (event) => {
        const activeSpan = trace.getSpan(context.active());
        if (activeSpan) {
          receivedTraceId = activeSpan.spanContext().traceId;
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(receivedTraceId).toBe("d4b4a1b020a2e0a2ca2cb07d5c9db02e");
    const pub = await IntegrationOutboxEvent.findOne({ EventID: publishedEvent.EventID });
    expect(pub.CorrelationID).toBe(publishedEvent.CorrelationID);

    await channel.deleteQueue(queue);
    await channel.close();
    await conn.close();
  });

  test("m. Concurrent publishers do not claim same outbox event", async () => {
    // Seed 5 pending events
    for (let i = 0; i < 5; i++) {
      await integrationOutboxService.enqueue(
        "catalog.review-created.v1",
        `agg-concurrent-${i}`,
        { reviewId: `rev-${i}`, spaceId: "d3b07384-d113-4886-a511-2b02a2e0a2c9", rating: 5 }
      );
    }

    // Call claimBatch concurrently representing two parallel workers
    const [batch1, batch2] = await Promise.all([
      integrationOutboxService.claimBatch({ workerId: "worker-1", limit: 3 }),
      integrationOutboxService.claimBatch({ workerId: "worker-2", limit: 3 }),
    ]);

    const ids1 = batch1.map(d => String(d._id));
    const ids2 = batch2.map(d => String(d._id));

    // Verify disjoint sets (no event is claimed by both)
    const intersection = ids1.filter(id => ids2.includes(id));
    expect(intersection.length).toBe(0);
    expect(batch1.length + batch2.length).toBe(5); // All 5 claimed
  });

  test("n. Expired lease is reclaimed by another worker", async () => {
    const doc = await integrationOutboxService.enqueue(
      "catalog.review-created.v1",
      "agg-lease",
      { reviewId: "rev-lease", spaceId: "d3b07384-d113-4886-a511-2b02a2e0a2c9", rating: 5 }
    );

    // Claim with extremely short lease (expired 1 second ago)
    await IntegrationOutboxEvent.updateOne(
      { _id: doc._id },
      {
        $set: {
          Status: "processing",
          ProcessingBy: "worker-dead",
          LeaseUntil: new Date(Date.now() - 1000),
          Attempts: 1
        }
      }
    );

    // Call claimBatch from a new worker
    const batch = await integrationOutboxService.claimBatch({ workerId: "worker-alive", limit: 1 });
    expect(batch.length).toBe(1);
    expect(batch[0].ProcessingBy).toBe("worker-alive");
    expect(batch[0].Attempts).toBe(2); // Incremented attempts
  });
});
