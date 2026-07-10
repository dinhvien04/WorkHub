"use strict";

const mongoose = require("mongoose");
const env = require("../config/env");

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
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      /* ignore abort errors */
    }
    throw err;
  } finally {
    session.endSession();
  }
}

module.exports = { withTransaction };
