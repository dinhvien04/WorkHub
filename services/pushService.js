"use strict";

const dns = require("dns").promises;
const ipaddr = require("ipaddr.js");
const PushSubscription = require("../models/PushSubscription");
const { ValidationError } = require("../utils/errors");
const logger = require("../utils/logger");

function isBlockedIp(ip) {
  try {
    let addr = ipaddr.parse(ip);
    if (addr.kind() === "ipv6" && addr.isIPv4MappedAddress()) {
      addr = addr.toIPv4Address();
    }
    const range = addr.range();
    const blockedRanges = [
      "unspecified",
      "broadcast",
      "multicast",
      "linkLocal",
      "loopback",
      "carrierGradeNat",
      "private",
      "reserved",
      "uniqueLocal",
    ];
    return blockedRanges.includes(range);
  } catch (err) {
    return true;
  }
}

async function validateEndpoint(endpoint) {
  if (!endpoint) {
    throw new ValidationError("Thiếu endpoint push.");
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch (err) {
    throw new ValidationError("Endpoint không hợp lệ.");
  }
  if (url.protocol !== "https:") {
    throw new ValidationError("Endpoint phải sử dụng giao thức https.");
  }
  const hostname = url.hostname;
  if (!hostname) {
    throw new ValidationError("Endpoint không hợp lệ.");
  }
  let addresses = [];
  try {
    const lookupResult = await dns.lookup(hostname, { all: true });
    addresses = lookupResult.map((r) => r.address);
  } catch (err) {
    throw new ValidationError("Không thể phân giải tên miền của endpoint.");
  }
  if (addresses.length === 0) {
    throw new ValidationError("Không thể phân giải tên miền của endpoint.");
  }
  for (const ip of addresses) {
    if (isBlockedIp(ip)) {
      throw new ValidationError("Endpoint không hợp lệ (SSRF prevented).");
    }
  }
}

async function saveSubscription({ userId, endpoint, keys, userAgent }) {
  await validateEndpoint(endpoint);

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

  const activeSubs = await PushSubscription.find({
    UserID: userId,
    Status: "active",
  }).sort({ createdAt: 1 });

  if (activeSubs.length > 10) {
    const toRevokeCount = activeSubs.length - 10;
    const toRevoke = activeSubs.slice(0, toRevokeCount);
    for (const sub of toRevoke) {
      sub.Status = "revoked";
      await sub.save();
    }
  }

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
    webpush = require("web-push");
  } catch {
    logger.warn(
      "web-push package not installed — set VAPID + npm i web-push to send",
    );
    return { sent: 0, mode: "vapid-configured-no-package" };
  }
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:ops@workhub.local",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
  } catch (err) {
    logger.error(`Failed to set VAPID details: ${err.message}`);
    return { sent: 0, mode: "vapid-config-error", error: err.message };
  }
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
