"use strict";

const crypto = require("crypto");
const OutboxEvent = require("../models/OutboxEvent");

/**
 * Enqueue a side-effect inside an optional Mongo session (transaction-safe).
 * Unique IdempotencyKey makes retries safe.
 */
async function enqueue(
  {
    type,
    entityType = "",
    entityId = null,
    recipientId = null,
    payload = {},
    idempotencyKey,
    availableAt = null,
  },
  opts = {},
) {
  if (!type || !idempotencyKey) {
    throw new Error("outbox enqueue requires type and idempotencyKey");
  }
  const session = opts.session || null;
  const doc = {
    Type: type,
    EntityType: entityType,
    EntityID: entityId,
    RecipientID: recipientId,
    Payload: payload,
    IdempotencyKey: String(idempotencyKey).slice(0, 200),
    Status: "pending",
    AvailableAt: availableAt || new Date(),
  };
  try {
    if (session) {
      const [created] = await OutboxEvent.create([doc], { session });
      return created;
    }
    return await OutboxEvent.create(doc);
  } catch (err) {
    if (err.code === 11000) {
      const q = OutboxEvent.findOne({ IdempotencyKey: doc.IdempotencyKey });
      if (session) q.session(session);
      return q;
    }
    throw err;
  }
}

async function enqueueNotification(
  { userId, title, body, type = "system", entityType, entityId, link },
  opts = {},
) {
  const key =
    opts.idempotencyKey ||
    `notify:${entityType || "x"}:${entityId || crypto.randomBytes(8).toString("hex")}:${userId}`;
  return enqueue(
    {
      type: "notification",
      entityType: entityType || "",
      entityId: entityId || null,
      recipientId: userId,
      payload: { userId, title, body, type, entityType, entityId, link },
      idempotencyKey: key,
    },
    opts,
  );
}

async function enqueueEmailTemplate(
  { template, to, data, entityType, entityId },
  opts = {},
) {
  const key =
    opts.idempotencyKey ||
    `email:${template}:${entityId || to}:${crypto.createHash("sha256").update(String(to)).digest("hex").slice(0, 12)}`;
  return enqueue(
    {
      type: "email_template",
      entityType: entityType || "",
      entityId: entityId || null,
      payload: { template, to, data },
      idempotencyKey: key,
    },
    opts,
  );
}

async function enqueueAudit(
  { userId, action, entityType, entityId, message, level = "info" },
  opts = {},
) {
  const key =
    opts.idempotencyKey ||
    `audit:${action}:${entityId || "x"}:${userId || "sys"}`;
  return enqueue(
    {
      type: "audit",
      entityType: entityType || "",
      entityId: entityId || null,
      recipientId: userId || null,
      payload: { userId, action, entityType, entityId, message, level },
      idempotencyKey: key,
    },
    opts,
  );
}

/**
 * Claim pending outbox rows for processing (lease-based).
 */
async function claimBatch({
  workerId: _workerId,
  limit = 20,
  leaseMs = 60_000,
} = {}) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const claimed = [];
  for (let i = 0; i < limit; i += 1) {
    const doc = await OutboxEvent.findOneAndUpdate(
      {
        Status: { $in: ["pending", "failed"] },
        AvailableAt: { $lte: now },
        $or: [{ LeaseUntil: null }, { LeaseUntil: { $lte: now } }],
      },
      {
        $set: { Status: "processing", LeaseUntil: leaseUntil },
        $inc: { Attempts: 1 },
      },
      { new: true, sort: { AvailableAt: 1 } },
    );
    if (!doc) break;
    claimed.push(doc);
  }
  return claimed;
}

async function markSent(id) {
  return OutboxEvent.findOneAndUpdate(
    { _id: id, Status: "processing" },
    {
      $set: {
        Status: "sent",
        ProcessedAt: new Date(),
        LeaseUntil: null,
        LastError: "",
      },
    },
    { new: true },
  );
}

async function markFailed(id, error, { maxAttempts = 8 } = {}) {
  const doc = await OutboxEvent.findById(id);
  if (!doc) return null;
  const dead = (doc.Attempts || 0) >= maxAttempts;
  const backoffMs = Math.min(
    3600_000,
    1000 * 2 ** Math.min(doc.Attempts || 1, 10),
  );
  return OutboxEvent.findOneAndUpdate(
    { _id: id },
    {
      $set: {
        Status: dead ? "dead" : "failed",
        LastError: String(error || "").slice(0, 500),
        LeaseUntil: null,
        AvailableAt: new Date(Date.now() + backoffMs),
      },
    },
    { new: true },
  );
}

/**
 * Deliver one outbox event (best-effort handlers).
 */
async function deliver(event) {
  if (event.Type === "notification") {
    const { notifyUser } = require("./notificationService");
    const p = event.Payload || {};
    await notifyUser({
      userId: p.userId || event.RecipientID,
      title: p.title,
      body: p.body,
      type: p.type || "system",
      entityType: p.entityType,
      entityId: p.entityId,
      link: p.link,
    });
    return;
  }
  if (event.Type === "email_template") {
    const emailService = require("./emailService");
    const p = event.Payload || {};
    const data = { ...(p.data || {}) };
    let to = p.to;
    if (!to) {
      const User = require("../models/User");
      if (data.customerId) {
        const u = await User.findById(data.customerId)
          .select("Email FullName NotifyEmail")
          .lean();
        if (u?.Email && u.NotifyEmail !== false) {
          to = u.Email;
          data.customerName = data.customerName || u.FullName;
        }
      } else if (data.hostId) {
        const u = await User.findById(data.hostId)
          .select("Email FullName NotifyEmail")
          .lean();
        if (u?.Email && u.NotifyEmail !== false) {
          to = u.Email;
          data.hostName = data.hostName || u.FullName;
        }
      }
    }
    if (!to) return; // nothing to send
    await emailService.safeSendTemplate(p.template, {
      to,
      ...data,
    });
    return;
  }
  if (event.Type === "email") {
    const emailService = require("./emailService");
    const p = event.Payload || {};
    await emailService.sendGeneric(p);
    return;
  }
  if (event.Type === "audit") {
    const logActivity = require("../utils/auditLogger");
    const p = event.Payload || {};
    await logActivity(
      p.userId,
      p.action,
      p.entityType,
      p.entityId,
      p.message,
      p.level || "info",
    );
    return;
  }
  if (event.Type === "metrics") {
    try {
      const metrics = require("../utils/metrics");
      const p = event.Payload || {};
      if (p.fn && typeof metrics[p.fn] === "function") metrics[p.fn]();
    } catch {
      /* ignore */
    }
    return;
  }
}

async function processPending(opts = {}) {
  const workerId = opts.workerId || `outbox-${process.pid}`;
  const batch = await claimBatch({
    workerId,
    limit: opts.limit || 20,
    leaseMs: opts.leaseMs || 60_000,
  });
  const results = [];
  for (const ev of batch) {
    try {
      await deliver(ev);
      await markSent(ev._id);
      results.push({ id: ev._id, ok: true });
    } catch (err) {
      await markFailed(ev._id, err.message);
      results.push({ id: ev._id, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = {
  enqueue,
  enqueueNotification,
  enqueueEmailTemplate,
  enqueueAudit,
  claimBatch,
  markSent,
  markFailed,
  deliver,
  processPending,
};
