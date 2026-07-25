"use strict";

const mongoose = require("mongoose");
const logger = require("../utils/logger");

async function connectDB(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  logger.info("MongoDB connected");
}

/**
 * Fail fast when production requires transactions but topology cannot support them.
 */
async function assertTransactionCapability({ required = false } = {}) {
  if (!required) return { ok: true, skipped: true };
  const admin = mongoose.connection.db.admin();
  let hello;
  try {
    hello = await admin.command({ hello: 1 });
  } catch {
    hello = await admin.command({ isMaster: 1 });
  }
  const isReplica =
    Boolean(hello.setName) ||
    hello.msg === "isdbgrid" ||
    (Array.isArray(hello.hosts) && hello.hosts.length > 0);
  if (!isReplica) {
    const err = new Error(
      "MongoDB transactions require a replica set or mongos. Standalone topology is not supported when ENABLE_TRANSACTIONS=true.",
    );
    err.code = "TRANSACTIONS_UNSUPPORTED_TOPOLOGY";
    throw err;
  }

  // Capability probe: multi-doc transaction on a dedicated collection
  const col = mongoose.connection.db.collection("_tx_capability_probe");
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await col.insertOne({ t: Date.now(), probe: true }, { session });
    await session.commitTransaction();
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      /* ignore */
    }
    const e = new Error(
      `MongoDB transaction capability probe failed: ${err.message}`,
    );
    e.code = "TRANSACTIONS_PROBE_FAILED";
    e.cause = err;
    throw e;
  } finally {
    session.endSession();
  }
  try {
    await col.deleteMany({ probe: true });
  } catch {
    /* ignore */
  }
  logger.info("MongoDB transaction capability probe OK");
  return { ok: true, replica: true };
}

async function disconnectDB() {
  await mongoose.disconnect();
  logger.info("MongoDB disconnected");
}

module.exports = { connectDB, disconnectDB, assertTransactionCapability };
