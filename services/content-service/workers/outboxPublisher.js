"use strict";

const ContentOutbox = require("../models/ContentOutbox");
const { messaging } = require("@workhub/observability");
const consumerService = require("../services/consumerService");
const crypto = require("crypto");

async function claimOutboxBatch(workerId, limit = 10, leaseMs = 30000) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const claimed = [];

  let count = 0;
  while (count < limit) {
    const doc = await ContentOutbox.findOneAndUpdate(
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

async function processOutbox(workerId = `content-outbox-${crypto.randomUUID()}`) {
  const channel = consumerService.getChannel();
  if (!channel) return 0;

  const batch = await claimOutboxBatch(workerId, 10);
  if (batch.length === 0) return 0;

  let successCount = 0;
  for (const item of batch) {
    try {
      // Publish event envelope to RabbitMQ exchange
      await messaging.publishEvent(channel, item.Payload);

      item.Status = "published";
      item.LastError = null;
      await item.save();

      successCount++;
    } catch (err) {
      console.error(`[OutboxPublisher] Failed to publish content event ${item._id}:`, err.message);

      const nextDelayMs = Math.min(1000 * Math.pow(2, item.Attempts), 3600000);
      item.AvailableAt = new Date(Date.now() + nextDelayMs);

      if (item.Attempts >= 5) {
        item.Status = "dead";
      } else {
        item.Status = "failed";
      }
      item.LastError = err.message;
      await item.save();
    }
  }

  return successCount;
}

let intervalId = null;

function start(intervalMs = 5000) {
  if (intervalId) return;

  const workerId = `content-outbox-${crypto.randomUUID()}`;
  console.log(`[OutboxPublisher] Starting background outbox publisher with ID: ${workerId}`);

  intervalId = setInterval(async () => {
    try {
      await processOutbox(workerId);
    } catch (err) {
      console.error("[OutboxPublisher] Outbox execution loop failed:", err.message);
    }
  }, intervalMs);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[OutboxPublisher] Stopped outbox publisher.");
  }
}

module.exports = {
  start,
  stop,
  processOutbox,
};
