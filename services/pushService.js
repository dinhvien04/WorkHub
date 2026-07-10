'use strict';

const PushSubscription = require('../models/PushSubscription');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

async function saveSubscription({ userId, endpoint, keys, userAgent }) {
  if (!endpoint) throw new ValidationError('Thiếu endpoint push.');
  const doc = await PushSubscription.findOneAndUpdate(
    { UserID: userId, Endpoint: endpoint },
    {
      $set: {
        Keys: {
          p256dh: keys?.p256dh || '',
          auth: keys?.auth || '',
        },
        UserAgent: String(userAgent || '').slice(0, 300),
        Status: 'active',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc;
}

async function revokeSubscription({ userId, endpoint }) {
  return PushSubscription.findOneAndUpdate(
    { UserID: userId, Endpoint: endpoint },
    { $set: { Status: 'revoked' } },
    { new: true }
  );
}

async function listSubscriptions(userId) {
  return PushSubscription.find({ UserID: userId, Status: 'active' }).lean();
}

/**
 * Best-effort push dispatch. Without VAPID keys, only logs (dev).
 * Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY for web-push library later.
 */
async function notifyPush(userId, payload) {
  const subs = await listSubscriptions(userId);
  if (!subs.length) return { sent: 0 };
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    logger.info(
      { userId: String(userId), n: subs.length, title: payload?.title },
      'push: VAPID not configured — subscription stored only'
    );
    return { sent: 0, stored: subs.length, mode: 'dev-log' };
  }
  // Optional: integrate web-push when dependency added
  return { sent: 0, mode: 'vapid-configured-no-sender' };
}

function publicVapidKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

module.exports = {
  saveSubscription,
  revokeSubscription,
  listSubscriptions,
  notifyPush,
  publicVapidKey,
};
