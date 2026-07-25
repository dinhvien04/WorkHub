"use strict";

const CommunicationOutbox = require("../models/CommunicationOutbox");
const pushService = require("../services/pushService");
const crypto = require("crypto");

async function claimPushBatch(workerId, limit = 10, leaseMs = 30000) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const claimed = [];

  let count = 0;
  while (count < limit) {
    const doc = await CommunicationOutbox.findOneAndUpdate(
      {
        Type: "push",
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

async function processPushQueue(workerId = `push-worker-${crypto.randomUUID()}`) {
  const batch = await claimPushBatch(workerId, 10);
  if (batch.length === 0) return 0;

  let successCount = 0;
  for (const item of batch) {
    try {
      // Dispatch Web Push notification
      await pushService.notifyPush(item.RecipientID, item.Payload);

      item.Status = "sent";
      item.LastError = null;
      await item.save();

      successCount++;
    } catch (err) {
      console.error(`[PushWorker] Failed to dispatch push outbox ${item._id}:`, err.message);

      const nextDelayMs = Math.min(1000 * Math.pow(2, item.Attempts), 3600000); // Exponential backoff max 1hr
      item.AvailableAt = new Date(Date.now() + nextDelayMs);

      if (item.Attempts >= 8) {
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

  const workerId = `push-worker-${crypto.randomUUID()}`;
  console.log(`[PushWorker] Starting background push delivery loop with ID: ${workerId}`);

  intervalId = setInterval(async () => {
    try {
      await processPushQueue(workerId);
    } catch (err) {
      console.error("[PushWorker] Loop execution encountered error:", err.message);
    }
  }, intervalMs);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[PushWorker] Stopped push delivery loop.");
  }
}

module.exports = {
  start,
  stop,
  processPushQueue,
};
