"use strict";

/**
 * Distributed lock for critical sections (booking slot acquire).
 * - Memory Map fallback (single instance)
 * - Redis SET NX PX when REDIS_URL + client available
 */
const crypto = require("crypto");
const logger = require("./logger");

const memoryLocks = new Map(); // key -> { token, exp }

function memoryAcquire(key, ttlMs) {
  const now = Date.now();
  const cur = memoryLocks.get(key);
  if (cur && cur.exp > now) return null;
  const token = crypto.randomBytes(8).toString("hex");
  memoryLocks.set(key, { token, exp: now + ttlMs });
  return token;
}

function memoryRelease(key, token) {
  const cur = memoryLocks.get(key);
  if (cur && cur.token === token) memoryLocks.delete(key);
}

let redisClient = null;
let redisTried = false;

async function getRedis() {
  if (redisTried) return redisClient;
  redisTried = true;
  const url = process.env.REDIS_URL;
  if (!url || process.env.NODE_ENV === "test") return null;
  try {
    try {
      const Redis = require("ioredis");
      redisClient = new Redis(url, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      if (redisClient.status !== "ready") {
        await redisClient.connect().catch(() => {});
      }
      logger.info("Distributed lock: Redis (ioredis)");
      return redisClient;
    } catch {
      const { createClient } = require("redis");
      redisClient = createClient({ url });
      redisClient.on("error", (e) => logger.warn(`redis lock: ${e.message}`));
      await redisClient.connect();
      logger.info("Distributed lock: Redis (node-redis)");
      return redisClient;
    }
  } catch (err) {
    logger.warn(`Redis lock unavailable: ${err.message}`);
    redisClient = null;
    return null;
  }
}

/**
 * @returns {Promise<string|null>} lock token or null if not acquired
 */
async function acquireLock(key, ttlMs = 8000) {
  const client = await getRedis();
  if (!client) return memoryAcquire(key, ttlMs);

  const token = crypto.randomBytes(16).toString("hex");
  const rkey = `lock:${key}`;
  try {
    // ioredis: set(key, val, 'PX', ttl, 'NX')
    if (typeof client.set === "function") {
      const res = await client.set(rkey, token, "PX", ttlMs, "NX");
      if (res === "OK" || res === true) return token;
      // node-redis v4: { NX: true, PX: ttl }
      if (res === null) {
        const res2 = await client.set(rkey, token, { NX: true, PX: ttlMs });
        if (res2 === "OK") return token;
      }
      return res === "OK" ? token : null;
    }
  } catch (err) {
    logger.warn(`lock acquire failed, memory fallback: ${err.message}`);
    return memoryAcquire(key, ttlMs);
  }
  return null;
}

async function releaseLock(key, token) {
  if (!token) return;
  const client = await getRedis();
  if (!client) {
    memoryRelease(key, token);
    return;
  }
  const rkey = `lock:${key}`;
  try {
    // release only if token matches (Lua-ish via get+del)
    const val = await client.get(rkey);
    if (val === token) await client.del(rkey);
  } catch {
    memoryRelease(key, token);
  }
}

/**
 * Run fn under lock; retries briefly if contended.
 */
async function withLock(
  key,
  fn,
  { ttlMs = 8000, retries = 5, delayMs = 40 } = {},
) {
  let token = null;
  for (let i = 0; i < retries; i++) {
    token = await acquireLock(key, ttlMs);
    if (token) break;
    await new Promise((r) =>
      setTimeout(r, delayMs + Math.floor(Math.random() * delayMs)),
    );
  }
  if (!token) {
    const err = new Error("Hệ thống đang bận (lock). Thử lại sau.");
    err.statusCode = 429;
    err.code = "LOCK_BUSY";
    err.isOperational = true;
    throw err;
  }
  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  withLock,
  memoryAcquire,
  memoryRelease,
};
