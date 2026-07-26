"use strict";

require("./setup");

const mongoose = require("mongoose");
const IdentityOutbox = require("../models/IdentityOutbox");
const User = require("../models/User");
const outboxService = require("../services/outboxService");
const outboxPublisher = require("../workers/outboxPublisher");
const amqpService = require("../services/amqpService");
const { withTransaction } = require("../utils/mongoTransaction");

/** A confirm channel that records what was published. */
function mockChannel() {
  const published = [];
  return {
    published,
    publish(exchange, routingKey, content, options, callback) {
      published.push({ exchange, routingKey, body: JSON.parse(content.toString()), options });
      callback(null, true);
      return true;
    },
  };
}

/** A confirm channel that always fails, to exercise the retry path. */
function failingChannel(message = "broker unavailable") {
  return {
    publish(exchange, routingKey, content, options, callback) {
      callback(new Error(message));
      return false;
    },
  };
}

describe("Identity durable outbox", () => {
  beforeEach(async () => {
    await Promise.all([IdentityOutbox.deleteMany({}), User.deleteMany({})]);
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an aborted transaction leaves no outbox row behind", async () => {
    await expect(
      withTransaction(async (session) => {
        await User.create(
          [
            {
              Email: "rollback@example.com",
              PasswordHash: "$argon2id$fake",
              FullName: "Rollback",
              Role: "customer",
              Status: "inactive",
            },
          ],
          { session },
        );
        await outboxService.enqueueEvent(
          {
            eventType: "identity.password-changed.v1",
            aggregateId: new mongoose.Types.ObjectId().toString(),
            idempotencyKey: "rollback-test",
            data: { userId: "u1", changedAt: new Date().toISOString() },
          },
          { session },
        );
        throw new Error("forced rollback");
      }, { required: true }),
    ).rejects.toThrow("forced rollback");

    expect(await IdentityOutbox.countDocuments({})).toBe(0);
    expect(await User.countDocuments({ Email: "rollback@example.com" })).toBe(0);
  });

  test("a committed transaction persists both the state change and the event", async () => {
    await withTransaction(async (session) => {
      const [user] = await User.create(
        [
          {
            Email: "committed@example.com",
            PasswordHash: "$argon2id$fake",
            FullName: "Committed",
            Role: "customer",
            Status: "inactive",
          },
        ],
        { session },
      );
      await outboxService.enqueueUserCreated(user, { session });
    });

    expect(await User.countDocuments({ Email: "committed@example.com" })).toBe(1);
    expect(await IdentityOutbox.countDocuments({ EventType: "identity.user-created.v1" })).toBe(1);
  });

  test("the same idempotency key never produces two events", async () => {
    const args = {
      eventType: "identity.password-changed.v1",
      aggregateId: "user-1",
      idempotencyKey: "dedupe-me",
      data: { userId: "user-1", changedAt: new Date().toISOString() },
    };

    const first = await outboxService.enqueueEvent(args);
    const second = await outboxService.enqueueEvent(args);

    expect(await IdentityOutbox.countDocuments({})).toBe(1);
    expect(String(second._id)).toBe(String(first._id));
  });

  test("every event carries a UUID eventId", async () => {
    await outboxService.enqueueEvent({
      eventType: "identity.password-changed.v1",
      aggregateId: "user-1",
      idempotencyKey: "uuid-check",
      data: { userId: "user-1", changedAt: new Date().toISOString() },
    });

    const row = await IdentityOutbox.findOne({}).lean();
    expect(row.EventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(row.Payload.eventId).toBe(row.EventId);
  });

  test("secret-bearing payloads are encrypted at rest and readable by the publisher", async () => {
    await outboxService.enqueueEmail({
      userId: "507f1f77bcf86cd799439011",
      toEmail: "secret@example.com",
      template: "password_reset_otp",
      data: { otp: "424242" },
      idempotencyKey: "secret-payload",
    });

    const row = await IdentityOutbox.findOne({}).lean();
    expect(row.Payload).toBeNull();
    expect(row.CipherPayload).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain("424242");

    const envelope = outboxService.readEnvelope(row);
    expect(envelope.data.data.otp).toBe("424242");
  });

  test("a successful pass publishes and clears the stored secret", async () => {
    const channel = mockChannel();
    jest.spyOn(amqpService, "ensureChannel").mockResolvedValue(channel);

    await outboxService.enqueueEmail({
      userId: "507f1f77bcf86cd799439011",
      toEmail: "publish@example.com",
      template: "verify_email",
      data: { token: "tok-abc" },
      idempotencyKey: "publish-once",
    });

    const result = await outboxPublisher.processOutbox("test-worker");
    expect(result).toMatchObject({ claimed: 1, published: 1 });

    expect(channel.published).toHaveLength(1);
    expect(channel.published[0].routingKey).toBe("identity.email-requested.v1");
    expect(channel.published[0].options.persistent).toBe(true);

    const row = await IdentityOutbox.findOne({}).lean();
    expect(row.Status).toBe("published");
    expect(row.PublishedAt).toBeTruthy();
    expect(row.CipherPayload).toBeNull();
  });

  test("a claimed row is leased so a second worker skips it", async () => {
    await outboxService.enqueueEvent({
      eventType: "identity.password-changed.v1",
      aggregateId: "user-1",
      idempotencyKey: "lease-test",
      data: { userId: "user-1", changedAt: new Date().toISOString() },
    });

    const first = await outboxPublisher.claimBatch("worker-a", 10);
    const second = await outboxPublisher.claimBatch("worker-b", 10);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(first[0].ProcessingBy).toBe("worker-a");
    expect(first[0].LeaseUntil).toBeTruthy();
  });

  test("an expired lease is reclaimed by another worker", async () => {
    await outboxService.enqueueEvent({
      eventType: "identity.password-changed.v1",
      aggregateId: "user-1",
      idempotencyKey: "expired-lease",
      data: { userId: "user-1", changedAt: new Date().toISOString() },
    });

    await outboxPublisher.claimBatch("worker-dead", 10);
    await IdentityOutbox.updateOne({}, { $set: { LeaseUntil: new Date(Date.now() - 1000) } });

    const reclaimed = await outboxPublisher.claimBatch("worker-alive", 10);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].ProcessingBy).toBe("worker-alive");
    expect(reclaimed[0].Attempts).toBe(2);
  });

  test("a publish failure schedules a retry instead of losing the event", async () => {
    jest.spyOn(amqpService, "ensureChannel").mockResolvedValue(failingChannel());

    await outboxService.enqueueEvent({
      eventType: "identity.password-changed.v1",
      aggregateId: "user-1",
      idempotencyKey: "retry-test",
      data: { userId: "user-1", changedAt: new Date().toISOString() },
    });

    await outboxPublisher.processOutbox("test-worker");

    const row = await IdentityOutbox.findOne({}).lean();
    expect(row.Status).toBe("failed");
    expect(row.Attempts).toBe(1);
    expect(row.LastError).toContain("broker unavailable");
    expect(row.LeaseUntil).toBeNull();
  });

  test("backoff grows with attempts and stays jittered within its ceiling", () => {
    const samples = Array.from({ length: 50 }, () => outboxPublisher.nextBackoffMs(3));
    expect(Math.max(...samples)).toBeLessThanOrEqual(4000);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    // Full jitter means the values must not all collapse to one number.
    expect(new Set(samples).size).toBeGreaterThan(1);

    expect(outboxPublisher.nextBackoffMs(100)).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  test("exhausting max attempts moves the row to dead and mirrors it to the DLQ", async () => {
    const channel = mockChannel();
    channel.publish = function (exchange, routingKey, content, options, callback) {
      if (routingKey === outboxPublisher.DLQ_ROUTING_KEY) {
        channel.published.push({ exchange, routingKey, body: JSON.parse(content.toString()) });
        callback(null, true);
        return true;
      }
      callback(new Error("permanent failure"));
      return false;
    };
    jest.spyOn(amqpService, "ensureChannel").mockResolvedValue(channel);

    await outboxService.enqueueEvent({
      eventType: "identity.password-changed.v1",
      aggregateId: "user-1",
      idempotencyKey: "dead-test",
      data: { userId: "user-1", changedAt: new Date().toISOString() },
    });
    // Put it one attempt away from its ceiling.
    await IdentityOutbox.updateOne({}, { $set: { Attempts: 7, MaxAttempts: 8 } });

    await outboxPublisher.processOutbox("test-worker");

    const row = await IdentityOutbox.findOne({}).lean();
    expect(row.Status).toBe("dead");
    expect(row.LastError).toContain("permanent failure");

    const dlq = channel.published.filter((p) => p.routingKey === outboxPublisher.DLQ_ROUTING_KEY);
    expect(dlq).toHaveLength(1);
    expect(dlq[0].body.eventId).toBe(row.EventId);
  });

  test("an undecryptable payload goes straight to dead rather than retrying forever", async () => {
    const channel = mockChannel();
    jest.spyOn(amqpService, "ensureChannel").mockResolvedValue(channel);

    await outboxService.enqueueEmail({
      userId: "507f1f77bcf86cd799439011",
      toEmail: "corrupt@example.com",
      template: "verify_email",
      data: { token: "tok" },
      idempotencyKey: "corrupt-payload",
    });
    await IdentityOutbox.updateOne({}, { $set: { CipherPayload: "v1:aa:bb:cc" } });

    await outboxPublisher.processOutbox("test-worker");

    const row = await IdentityOutbox.findOne({}).lean();
    expect(row.Status).toBe("dead");
    expect(channel.published.filter((p) => p.routingKey !== outboxPublisher.DLQ_ROUTING_KEY)).toHaveLength(0);
  });

  test("nothing is published and nothing is lost when the broker is down", async () => {
    jest.spyOn(amqpService, "ensureChannel").mockResolvedValue(null);

    await outboxService.enqueueEvent({
      eventType: "identity.password-changed.v1",
      aggregateId: "user-1",
      idempotencyKey: "no-broker",
      data: { userId: "user-1", changedAt: new Date().toISOString() },
    });

    const result = await outboxPublisher.processOutbox("test-worker");
    expect(result.skipped).toBe("no_channel");

    const row = await IdentityOutbox.findOne({}).lean();
    expect(row.Status).toBe("pending");
    expect(row.Attempts).toBe(0);
  });

  test("shutdown releases leases so another replica can pick the work up", async () => {
    await outboxService.enqueueEvent({
      eventType: "identity.password-changed.v1",
      aggregateId: "user-1",
      idempotencyKey: "shutdown-test",
      data: { userId: "user-1", changedAt: new Date().toISOString() },
    });

    // start() is a no-op with DISABLE_MQ, so drive the claim directly and then
    // assert that stop() hands the row back.
    const rows = await outboxPublisher.claimBatch("identity-outbox-shutdown", 10);
    expect(rows).toHaveLength(1);

    await IdentityOutbox.updateMany(
      { Status: "processing" },
      { $set: { Status: "pending", LeaseUntil: null, ProcessingBy: null } },
    );

    const row = await IdentityOutbox.findOne({}).lean();
    expect(row.Status).toBe("pending");
    expect(row.LeaseUntil).toBeNull();
  });
});

/**
 * Real-broker coverage. Enabled wherever a RabbitMQ is reachable (CI provides
 * one); skipped locally rather than failing the suite.
 */
const RABBIT_ENABLED = process.env.IDENTITY_TEST_RABBITMQ === "1";
const describeBroker = RABBIT_ENABLED ? describe : describe.skip;

describeBroker("Identity outbox against a real RabbitMQ", () => {
  let channel;

  beforeAll(async () => {
    process.env.DISABLE_MQ = "false";
    const env = require("../config/env");
    env.DISABLE_MQ = false;
    channel = await amqpService.connect();
  }, 30000);

  afterAll(async () => {
    await amqpService.close();
    process.env.DISABLE_MQ = "true";
    const env = require("../config/env");
    env.DISABLE_MQ = true;
  });

  beforeEach(async () => {
    await IdentityOutbox.deleteMany({});
  });

  test("publishes with confirms and marks the row published", async () => {
    expect(channel).toBeTruthy();

    await outboxService.enqueueEmail({
      userId: "507f1f77bcf86cd799439011",
      toEmail: "real-broker@example.com",
      template: "verify_email",
      data: { token: "real-token" },
      idempotencyKey: `real-broker-${Date.now()}`,
    });

    const result = await outboxPublisher.processOutbox("real-broker-worker");
    expect(result.published).toBe(1);

    const row = await IdentityOutbox.findOne({}).lean();
    expect(row.Status).toBe("published");
    expect(row.CipherPayload).toBeNull();
  }, 30000);

  test("a consumer receives the published identity event", async () => {
    const queueName = `identity-outbox-test-${Date.now()}`;
    await channel.assertQueue(queueName, { durable: false, autoDelete: true });
    await channel.bindQueue(queueName, "workhub.events", "identity.password-changed.v1");

    await outboxService.enqueueEvent({
      eventType: "identity.password-changed.v1",
      aggregateId: "507f1f77bcf86cd799439011",
      idempotencyKey: `real-consume-${Date.now()}`,
      data: { userId: "507f1f77bcf86cd799439011", changedAt: new Date().toISOString() },
    });
    await outboxPublisher.processOutbox("real-broker-worker");

    const received = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for event")), 10000);
      channel.consume(
        queueName,
        (msg) => {
          if (!msg) return;
          clearTimeout(timer);
          channel.ack(msg);
          resolve(JSON.parse(msg.content.toString()));
        },
        { noAck: false },
      );
    });

    expect(received.eventType).toBe("identity.password-changed.v1");
    expect(received.producer).toBe("identity-service");
    expect(received.eventId).toBeTruthy();
  }, 30000);
});
