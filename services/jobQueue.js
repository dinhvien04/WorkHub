'use strict';

const DeadLetter = require('../models/DeadLetter');
const logger = require('../utils/logger');

/**
 * Simple in-process queue with retry + dead letter (no Redis required).
 */
async function withRetry(fn, { queue = 'default', payload = {}, maxAttempts = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const delay = Math.min(2000, 100 * 2 ** attempt) + Math.floor(Math.random() * 50);
      logger.warn(`Queue ${queue} attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  await DeadLetter.create({
    Queue: queue,
    Payload: payload,
    Error: lastErr?.message || 'unknown',
    Attempts: maxAttempts,
    Status: 'open',
  });
  throw lastErr;
}

async function listDeadLetters({ limit = 50 } = {}) {
  return DeadLetter.find({ Status: 'open' }).sort({ createdAt: -1 }).limit(limit).lean();
}

async function discardDeadLetter(id) {
  return DeadLetter.findByIdAndUpdate(id, { $set: { Status: 'discarded' } }, { new: true });
}

module.exports = { withRetry, listDeadLetters, discardDeadLetter };
