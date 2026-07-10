'use strict';

const crypto = require('crypto');
const FeatureFlag = require('../models/FeatureFlag');
const env = require('../config/env');

function bucket(userId, key) {
  const h = crypto.createHash('sha256').update(`${key}:${userId || 'anon'}`).digest();
  return h[0] % 100;
}

/**
 * Evaluate whether a flag is on for a given context.
 */
async function isEnabled(key, { userId = null, role = null } = {}) {
  const flag = await FeatureFlag.findOne({ Key: key }).lean();
  if (!flag) return false;
  if (!flag.Enabled) return false;

  if (flag.Environments?.length) {
    const cur = env.NODE_ENV || 'development';
    if (!flag.Environments.includes(cur) && !flag.Environments.includes('*')) {
      return false;
    }
  }
  if (flag.Roles?.length && role && !flag.Roles.includes(role)) {
    return false;
  }
  const pct = typeof flag.Percentage === 'number' ? flag.Percentage : 100;
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  return bucket(userId, key) < pct;
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
  description = '',
  percentage = 100,
  roles = [],
  environments = [],
}) {
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
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function listAllFlags() {
  return FeatureFlag.find().sort({ Key: 1 }).lean();
}

module.exports = { isEnabled, listPublicFlags, upsertFlag, listAllFlags, bucket };
