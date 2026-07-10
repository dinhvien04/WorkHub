"use strict";

const PushSubscription = require("../models/PushSubscription");
const { ValidationError } = require("../utils/errors");
const logger = require("../utils/logger");

async function saveSubscription({ userId, endpoint, keys, userAgent }) {
  if (!endpoint) throw new ValidationError("Thiếu endpoint push.");
  const doc = await PushSubscription.findOneAndUpdate(
    { UserID: userId, Endpoint: endpoint },
    {
      $set: {
        Keys: {
          p256dh: keys?.p256dh || "",
          auth: keys?.auth || "",
        },
        UserAgent: String(userAgent || "").slice(0, 300),
        Status: "active",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc;
}

async function revokeSubscription({ userId, endpoint }) {
  return PushSubscription.findOneAndUpdate(
    { UserID: userId, Endpoint: endpoint },
    { $set: { Status: "revoked" } },
    { new: true },
  );
}

async function listSubscriptions(userId) {
  return PushSubscription.find({ UserID: userId, Status: "active" }).lean();
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
      "push: VAPID not configured — subscription stored only",
    );
    return { sent: 0, stored: subs.length, mode: "dev-log" };
  }
  // Optional peer dependency: npm i web-push
  let webpush;
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    webpush = require("web-push");
  } catch {
    logger.warn(
      "web-push package not installed — set VAPID + npm i web-push to send",
    );
    return { sent: 0, mode: "vapid-configured-no-package" };
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:ops@workhub.local",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  const body = JSON.stringify({
    title: payload?.title || "WorkHub",
    body: payload?.body || "",
    url: payload?.url || "/",
  });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.Endpoint,
          keys: { p256dh: s.Keys?.p256dh, auth: s.Keys?.auth },
        },
        body,
      );
      sent += 1;
    } catch (err) {
      logger.warn(`push send failed: ${err.message}`);
      if (err.statusCode === 410 || err.statusCode === 404) {
        await PushSubscription.updateOne(
          { _id: s._id },
          { $set: { Status: "revoked" } },
        );
      }
    }
  }
  return { sent, mode: "web-push" };
}

function publicVapidKey() {
  return process.env.VAPID_PUBLIC_KEY || "";
}

module.exports = {
  saveSubscription,
  revokeSubscription,
  listSubscriptions,
  notifyPush,
  publicVapidKey,
};
