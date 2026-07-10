'use strict';

/**
 * Optional distributed rate-limit store.
 * - Default: in-memory (single instance)
 * - If REDIS_URL set and `ioredis` or `redis` installed: shared counters
 *
 * Compatible with express-rate-limit v7+ custom store shape (increment/decrement/resetKey).
 */

const logger = require('./logger');

function memoryStore() {
  const hits = new Map(); // key -> { count, resetTime }

  return {
    async increment(key) {
      const now = Date.now();
      let row = hits.get(key);
      if (!row || row.resetTime <= now) {
        row = { count: 0, resetTime: now + 60_000 };
      }
      row.count += 1;
      hits.set(key, row);
      return {
        totalHits: row.count,
        resetTime: new Date(row.resetTime),
      };
    },
    async decrement(key) {
      const row = hits.get(key);
      if (row && row.count > 0) {
        row.count -= 1;
        hits.set(key, row);
      }
    },
    async resetKey(key) {
      hits.delete(key);
    },
  };
}

/**
 * Minimal Redis store using INCR + PEXPIRE.
 * Window is fixed per key expiry (approximate sliding via TTL refresh on first hit).
 */
function redisStore(client, { windowMs = 60_000 } = {}) {
  return {
    async increment(key) {
      const rkey = `rl:${key}`;
      const count = await client.incr(rkey);
      if (count === 1) {
        await client.pexpire(rkey, windowMs);
      }
      let ttl = await client.pttl(rkey);
      if (ttl < 0) ttl = windowMs;
      return {
        totalHits: count,
        resetTime: new Date(Date.now() + ttl),
      };
    },
    async decrement(key) {
      const rkey = `rl:${key}`;
      try {
        await client.decr(rkey);
      } catch {
        /* ignore */
      }
    },
    async resetKey(key) {
      await client.del(`rl:${key}`);
    },
  };
}

let cached = null;

async function getRateLimitStore(windowMs = 60_000) {
  if (cached) return cached;
  const url = process.env.REDIS_URL;
  if (!url) {
    cached = memoryStore();
    return cached;
  }
  try {
    let Redis;
    try {
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      Redis = require('ioredis');
      const client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
      await client.connect().catch(() => client); // ioredis may auto-connect
      // ping
      if (typeof client.ping === 'function') await client.ping();
      logger.info('Rate limit store: Redis (ioredis)');
      cached = redisStore(client, { windowMs });
      return cached;
    } catch {
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      const { createClient } = require('redis');
      const client = createClient({ url });
      client.on('error', (e) => logger.warn(`redis error: ${e.message}`));
      await client.connect();
      logger.info('Rate limit store: Redis (node-redis)');
      const adapter = {
        incr: (k) => client.incr(k),
        pexpire: (k, ms) => client.pExpire(k, ms),
        pttl: (k) => client.pTTL(k),
        decr: (k) => client.decr(k),
        del: (k) => client.del(k),
      };
      cached = redisStore(adapter, { windowMs });
      return cached;
    }
  } catch (err) {
    logger.warn(`Redis rate limit unavailable (${err.message}) — using memory store`);
    cached = memoryStore();
    return cached;
  }
}

/** Sync factory for express-rate-limit (uses memory until async init; prefer setStore later). */
function createMemoryStore() {
  return memoryStore();
}

module.exports = {
  getRateLimitStore,
  createMemoryStore,
  memoryStore,
  redisStore,
};
