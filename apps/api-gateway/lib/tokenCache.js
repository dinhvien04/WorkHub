"use strict";

/**
 * Bounded LRU cache for token introspection results.
 *
 * Entries are keyed by SHA-256 of the token, never the token itself: the cache
 * is a long-lived in-memory structure that shows up in heap dumps and crash
 * reports, and a raw JWT there is a usable credential.
 *
 * Bounded size matters as much as the TTL — an unbounded Map keyed by token
 * grows without limit under token churn or a spray of invalid tokens, which is
 * a memory-exhaustion vector.
 */
const crypto = require("crypto");

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_TTL_MS = 15000;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("base64url");
}

class TokenCache {
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    // Map preserves insertion order, which is what makes the LRU cheap: delete
    // + set moves a key to the newest position.
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  get(token) {
    const key = hashToken(token);
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.misses++;
      return null;
    }

    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(token, value, { ttlMs } = {}) {
    const key = hashToken(token);
    const effectiveTtl = Math.min(ttlMs || this.ttlMs, this.ttlMs);

    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + effectiveTtl,
      userId: value?.user?.userId ? String(value.user.userId) : null,
    });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
      this.evictions++;
    }
    return value;
  }

  delete(token) {
    return this.entries.delete(hashToken(token));
  }

  /**
   * Drop every cached entry for a user. Called when a revocation event says
   * their sessions or tokenVersion changed, so a logout takes effect before
   * the TTL would have expired the entry on its own.
   */
  evictUser(userId) {
    const target = String(userId);
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.userId === target) {
        this.entries.delete(key);
        removed++;
      }
    }
    this.evictions += removed;
    return removed;
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  stats() {
    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }
}

module.exports = { TokenCache, hashToken, DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS };
