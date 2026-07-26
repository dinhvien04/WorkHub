"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const InboxMessage = require("../models/InboxMessage");
const ConsumerDeadLetter = require("../models/ConsumerDeadLetter");
const { redactEventForStorage } = require("@workhub/contracts");

/**
 * Executes a callback process idempotently using the Inbox Pattern.
 * Ensures at-least-once message delivery yields effectively-once business effect within local transaction.
 */
async function processIdempotent(eventId, consumerName, callback) {
  // 1. Optimistic read check
  const existing = await InboxMessage.findOne({ EventID: eventId, ConsumerName: consumerName });
  if (existing) {
    if (existing.Status === "completed") {
      return { status: "skipped", reason: "already_processed" };
    }
    if (existing.Status === "processing") {
      throw new Error(`Event ${eventId} is currently processing by consumer ${consumerName}`);
    }
  }

  // 2. Perform Mongoose Transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let inboxDoc;
    try {
      // Optimistically create with processing status
      [inboxDoc] = await InboxMessage.create(
        [
          {
            EventID: eventId,
            ConsumerName: consumerName,
            Status: "processing",
          },
        ],
        { session }
      );
    } catch (err) {
      // Catch unique index violation (duplicate collision)
      if (err.code === 11000) {
        await session.abortTransaction();
        session.endSession();
        return { status: "skipped", reason: "already_processed_concurrent" };
      }
      throw err;
    }

    // Execute business logic passing the transactional session
    const result = await callback(session);

    // Complete transaction
    inboxDoc.Status = "completed";
    inboxDoc.ProcessedAt = new Date();
    await inboxDoc.save({ session });

    await session.commitTransaction();
    session.endSession();

    return { status: "processed", result };
  } catch (error) {
    try {
      await session.abortTransaction();
    } catch (_) {
      // Silently ignore abort failures during cleanup
    }
    session.endSession();
    throw error;
  }
}

/**
 * Logs a dead-lettered message to the database for administrative review and retry.
 */
async function logDeadLetter(msg, event, errorReason) {
  const messageId = msg.properties.messageId || (event && event.eventId) || `dl-${crypto.randomUUID()}`;

  // We can extract queue name from routing fields or use a fallback
  const queueName = msg.fields.consumerTag || "unknown-queue";

  try {
    await ConsumerDeadLetter.findOneAndUpdate(
      { MessageID: messageId },
      {
        $set: {
          QueueName: queueName,
          RoutingKey: msg.fields.routingKey,
          // See packages/contracts: strip the secret before it lands in a
          // durable, TTL-less row that the admin DLQ API returns verbatim.
          Payload: redactEventForStorage(event),
          Headers: msg.properties.headers || {},
          Error: errorReason,
          Status: "pending",
        },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error("[InboxService] Failed to write dead letter to database:", err.message);
  }
}

module.exports = {
  processIdempotent,
  logDeadLetter,
};
