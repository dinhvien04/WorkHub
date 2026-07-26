"use strict";

/**
 * Identity outbox publisher.
 *
 * Claims due rows with a lease so multiple replicas can run safely, publishes
 * with publisher confirms, and retries with exponential backoff plus jitter.
 * Rows that exhaust MaxAttempts move to `dead` and are mirrored to the DLQ
 * rather than being retried forever or silently dropped.
 */
const crypto = require("crypto");
const IdentityOutbox = require("../models/IdentityOutbox");
const outboxService = require("../services/outboxService");
const amqpService = require("../services/amqpService");
const env = require("../config/env");
const { messaging } = require("@workhub/observability");

const DLQ_EXCHANGE = "workhub.events.dlx";
const DLQ_ROUTING_KEY = "identity-service-outbox.dlq";
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

/**
 * Exponential backoff with full jitter, so a broker outage does not produce a
 * synchronised retry stampede from every replica when it recovers.
 */
function nextBackoffMs(attempts) {
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
  return Math.floor(Math.random() * ceiling);
}

/**
 * Atomically claim up to `limit` due rows.
 *
 * The claim also picks up rows whose lease expired — that is how work is
 * recovered when a worker dies mid-publish.
 */
async function claimBatch(workerId, limit = env.OUTBOX_BATCH_SIZE, leaseMs = env.OUTBOX_LEASE_MS) {
  const claimed = [];

  for (let i = 0; i < limit; i++) {
    const now = new Date();
    const doc = await IdentityOutbox.findOneAndUpdate(
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
          LeaseUntil: new Date(now.getTime() + leaseMs),
        },
        $inc: { Attempts: 1 },
      },
      { new: true, sort: { AvailableAt: 1 } },
    );

    if (!doc) break;
    claimed.push(doc);
  }

  return claimed;
}

async function sendToDlq(channel, row, reason) {
  if (!channel) return;
  try {
    const body = Buffer.from(
      JSON.stringify({
        eventId: row.EventId,
        eventType: row.EventType,
        aggregateId: row.AggregateId,
        attempts: row.Attempts,
        reason,
        failedAt: new Date().toISOString(),
      }),
    );

    await new Promise((resolve, reject) => {
      channel.publish(
        DLQ_EXCHANGE,
        DLQ_ROUTING_KEY,
        body,
        { persistent: true, messageId: row.EventId },
        (err, ok) => (err ? reject(err) : resolve(ok)),
      );
    });
  } catch (err) {
    console.error(`[IdentityOutbox] Failed to mirror ${row.EventId} to DLQ:`, err.message);
  }
}

async function markDead(row, channel, reason) {
  row.Status = "dead";
  row.LastError = reason;
  row.LeaseUntil = null;
  row.ProcessingBy = null;
  await row.save();
  await sendToDlq(channel, row, reason);
  console.error(
    `[IdentityOutbox] Event ${row.EventId} (${row.EventType}) is dead after ${row.Attempts} attempts: ${reason}`,
  );
}

/**
 * Publish one claimed row. Returns true when it reached the broker.
 */
async function publishRow(row, channel) {
  let envelope;
  try {
    envelope = outboxService.readEnvelope(row);
  } catch (err) {
    // A payload we cannot decrypt or parse will never become publishable —
    // retrying it just burns attempts, so it goes straight to dead.
    await markDead(row, channel, `Unreadable payload: ${err.message}`);
    return false;
  }

  try {
    await messaging.publishEvent(channel, envelope);

    row.Status = "published";
    row.PublishedAt = new Date();
    row.LastError = null;
    row.LeaseUntil = null;
    row.ProcessingBy = null;
    // The secret is delivered; do not keep it at rest any longer.
    if (row.CipherPayload) row.CipherPayload = null;
    await row.save();
    return true;
  } catch (err) {
    if (row.Attempts >= row.MaxAttempts) {
      await markDead(row, channel, err.message);
      return false;
    }

    row.Status = "failed";
    row.LastError = err.message;
    row.AvailableAt = new Date(Date.now() + nextBackoffMs(row.Attempts));
    row.LeaseUntil = null;
    row.ProcessingBy = null;
    await row.save();
    return false;
  }
}

/**
 * Run one drain pass. Exposed so tests can pump the outbox deterministically
 * instead of waiting on the interval.
 */
async function processOutbox(workerId = `identity-outbox-${crypto.randomUUID()}`) {
  const channel = await amqpService.ensureChannel();
  if (!channel) return { claimed: 0, published: 0, skipped: "no_channel" };

  const batch = await claimBatch(workerId);
  if (batch.length === 0) return { claimed: 0, published: 0 };

  let published = 0;
  for (const row of batch) {
    const ok = await publishRow(row, channel);
    if (ok) published++;
  }

  return { claimed: batch.length, published };
}

let timer = null;
let running = false;
let draining = false;
let workerId = null;

function start(intervalMs = env.OUTBOX_POLL_INTERVAL_MS) {
  if (timer || env.DISABLE_MQ) return;

  workerId = `identity-outbox-${crypto.randomUUID()}`;
  running = true;
  console.log(`[IdentityOutbox] Publisher started as ${workerId}`);

  timer = setInterval(async () => {
    // Skip a tick rather than overlapping passes if the previous one is slow.
    if (draining || !running) return;
    draining = true;
    try {
      await processOutbox(workerId);
    } catch (err) {
      console.error("[IdentityOutbox] Publish loop error:", err.message);
    } finally {
      draining = false;
    }
  }, intervalMs);

  if (timer.unref) timer.unref();
}

/**
 * Stop accepting new passes and let the in-flight one finish, so a deploy does
 * not leave rows stuck in `processing` waiting for their lease to lapse.
 */
async function stop({ timeoutMs = 10000 } = {}) {
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  const deadline = Date.now() + timeoutMs;
  while (draining && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (workerId) {
    // Release any lease this worker still holds so another replica can pick
    // the row up immediately instead of waiting out the lease.
    await IdentityOutbox.updateMany(
      { Status: "processing", ProcessingBy: workerId },
      { $set: { Status: "pending", LeaseUntil: null, ProcessingBy: null } },
    ).catch(() => {});
  }

  console.log("[IdentityOutbox] Publisher stopped.");
}

module.exports = {
  start,
  stop,
  processOutbox,
  claimBatch,
  publishRow,
  nextBackoffMs,
  DLQ_ROUTING_KEY,
};
