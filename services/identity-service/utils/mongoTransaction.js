"use strict";

/**
 * Lightweight transaction helper for identity-service.
 * Falls back to non-transactional execution when replica set is unavailable.
 */
async function withTransaction(fn, { required = false } = {}) {
  const mongoose = require("mongoose");
  if (mongoose.connection.readyState !== 1) {
    throw new Error("Mongo connection is not ready");
  }

  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch {
        /* ignore */
      }
    }
    if (required) throw err;
    // Fallback for standalone Mongo in some local setups
    if (
      /Transaction numbers are only allowed|replica set|not supported/i.test(
        String(err.message || ""),
      )
    ) {
      return fn(null);
    }
    throw err;
  } finally {
    if (session) session.endSession();
  }
}

module.exports = { withTransaction };
