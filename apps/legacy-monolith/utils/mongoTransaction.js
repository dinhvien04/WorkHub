"use strict";

const mongoose = require("mongoose");
const env = require("../config/env");

/**
 * Errors MongoDB itself asks the caller to retry.
 *
 * These are not failures — a write conflict or a concurrent catalog change
 * means "try again", and the server says so in the message. Anything that
 * opens a transaction by hand rather than through withTransaction() needs the
 * same predicate, which is why it is exported.
 */
function isTransientTransactionError(err) {
  if (!err) return false;
  const msg = String(err.message || "");
  return (
    err.code === 112 || // WriteConflict
    err.code === 251 || // NoSuchTransaction
    err.codeName === "WriteConflict" ||
    err.codeName === "NoSuchTransaction" ||
    err.errorLabels?.includes?.("TransientTransactionError") ||
    msg.includes("Unable to acquire") ||
    msg.includes("catalog changes") ||
    msg.includes("TransientTransactionError") ||
    msg.includes("Please retry")
  );
}

/**
 * Run work inside a Mongo multi-doc transaction when ENABLE_TRANSACTIONS is on.
 * When off (memory mongo / tests), runs work(null) without a session.
 *
 * @param {(session: import('mongoose').ClientSession | null) => Promise<T>} work
 * @param {{ required?: boolean }} [opts] required=true refuses non-transaction path
 * @returns {Promise<T>}
 */
async function withTransaction(work, opts = {}) {
  const required = Boolean(opts.required);
  if (!env.ENABLE_TRANSACTIONS) {
    if (required && env.isProduction) {
      const err = new Error(
        "Mongo transactions are required for this financial operation in production.",
      );
      err.statusCode = 503;
      err.isOperational = true;
      err.code = "TRANSACTIONS_REQUIRED";
      throw err;
    }
    return work(null);
  }

  const session = await mongoose.startSession();
  try {
    // Explicit transaction options for replica-set (incl. memory replset CI)
    session.startTransaction({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      maxCommitTimeMS: 60_000,
    });
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      /* ignore abort errors */
    }
    // Retry a few times on transient lock / catalog / write conflict
    const retries = opts._retries || 0;
    if (retries < 3 && isTransientTransactionError(err)) {
      await new Promise((r) => setTimeout(r, 50 * (retries + 1)));
      return withTransaction(work, { ...opts, _retries: retries + 1 });
    }
    throw err;
  } finally {
    session.endSession();
  }
}

module.exports = { withTransaction, isTransientTransactionError };
