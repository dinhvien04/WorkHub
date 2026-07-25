"use strict";

const crypto = require("crypto");
const FeatureFlag = require("../models/FeatureFlag");
const env = require("../config/env");

// ── In-process TTL cache (30s) to avoid per-request DB hits ──────────────────
/** @type {Map<string, { value: boolean, expiresAt: number }>} */
const _flagCache = new Map();
const FLAG_CACHE_TTL_MS = 30_000; // 30 seconds

function _getCached(cacheKey) {
  const entry = _flagCache.get(cacheKey);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    _flagCache.delete(cacheKey);
    return undefined;
  }
  return entry.value;
}

function _setCached(cacheKey, value) {
  _flagCache.set(cacheKey, { value, expiresAt: Date.now() + FLAG_CACHE_TTL_MS });
}

function clearFlagCache() {
  _flagCache.clear();
}
// ─────────────────────────────────────────────────────────────────────────────

function bucket(userId, key) {
  const h = crypto
    .createHash("sha256")
    .update(`${key}:${userId || "anon"}`)
    .digest();
  return h[0] % 100;
}

/**
 * Evaluate whether a flag is on for a given context.
 * Cached for FLAG_CACHE_TTL_MS to avoid a DB round-trip on every request.
 */
async function isEnabled(key, { userId = null, role = null } = {}) {
  const cacheKey = `${key}:${userId || "anon"}:${role || ""}`;
  const cached = _getCached(cacheKey);
  if (cached !== undefined) return cached;

  const flag = await FeatureFlag.findOne({ Key: key }).lean();
  let result = false;

  if (flag && flag.Enabled) {
    let pass = true;
    if (flag.Environments?.length) {
      const cur = env.NODE_ENV || "development";
      if (!flag.Environments.includes(cur) && !flag.Environments.includes("*")) {
        pass = false;
      }
    }
    if (pass && flag.Roles?.length && role && !flag.Roles.includes(role)) {
      pass = false;
    }
    if (pass) {
      const pct = typeof flag.Percentage === "number" ? flag.Percentage : 100;
      if (pct >= 100) result = true;
      else if (pct <= 0) result = false;
      else result = bucket(userId, key) < pct;
    }
  }

  _setCached(cacheKey, result);
  return result;
}

async function listPublicFlags(context = {}) {
  const all = await FeatureFlag.find({ Enabled: true }).lean();
  const out = {};
  for (const f of all) {
    out[f.Key] = await isEnabled(f.Key, context);
  }
  return out;
}

async function upsertFlag({
  key,
  enabled,
  description = "",
  percentage = 100,
  roles = [],
  environments = [],
}) {
  // Invalidate entire cache on any flag change
  clearFlagCache();
  return FeatureFlag.findOneAndUpdate(
    { Key: key },
    {
      $set: {
        Enabled: !!enabled,
        Description: description,
        Percentage: Math.max(0, Math.min(100, Number(percentage) || 0)),
        Roles: roles,
        Environments: environments,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function listAllFlags() {
  return FeatureFlag.find().sort({ Key: 1 }).lean();
}

module.exports = {
  isEnabled,
  listPublicFlags,
  upsertFlag,
  listAllFlags,
  bucket,
  clearFlagCache,
};
