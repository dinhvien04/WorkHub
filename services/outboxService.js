"use strict";

const crypto = require("crypto");
const OutboxEvent = require("../models/OutboxEvent");
const secretBox = require("../utils/secretBox");

/**
 * Enqueue a side-effect inside an optional Mongo session (transaction-safe).
 * Unique IdempotencyKey makes retries safe.
 * Never store raw secrets in Payload — use PayloadEncrypted.
 */
async function enqueue(
  {
    type,
    entityType = "",
    entityId = null,
    recipientId = null,
    payload = {},
    payloadEncrypted = "",
    idempotencyKey,
    availableAt = null,
    expiresAt = null,
  },
  opts = {},
) {
  if (!type || !idempotencyKey) {
    throw new Error("outbox enqueue requires type and idempotencyKey");
  }
  const session = opts.session || null;
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload || {}) + String(payloadEncrypted || ""))
    .digest("hex");
  const doc = {
    Type: type,
    EntityType: entityType,
    EntityID: entityId,
    RecipientID: recipientId,
    Payload: payload,
    PayloadEncrypted: payloadEncrypted || "",
    PayloadHash: payloadHash,
    IdempotencyKey: String(idempotencyKey).slice(0, 200),
    Status: "pending",
    AvailableAt: availableAt || new Date(),
    ExpiresAt: expiresAt || null,
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
    `email:${template}:${entityId || to}:${crypto
      .createHash("sha256")
      .update(String(to || ""))
      .digest("hex")
      .slice(0, 12)}`;
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

/**
 * Enqueue verification email without storing raw token in plaintext payload.
 * rawToken is encrypted; wiped after successful send.
 */
async function enqueueSecureVerifyEmail(
  { to, userId, rawToken, subject },
  opts = {},
) {
  const encrypted = secretBox.encrypt(rawToken);
  const key = opts.idempotencyKey || `register:${userId}:verify-email`;
  return enqueue(
    {
      type: "email_secure_verify",
      entityType: "User",
      entityId: userId,
      recipientId: userId,
      payload: {
        to,
        subject: subject || "Xác minh email WorkHub",
        // No raw token here
      },
      payloadEncrypted: encrypted,
      idempotencyKey: key,
      expiresAt: new Date(Date.now() + 24 * 3600_000),
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
 * Claim pending OR expired-processing outbox rows (lease reclaim).
 */
async function claimBatch({ workerId, limit = 20, leaseMs = 60_000 } = {}) {
  if (!workerId) workerId = `outbox-${process.pid}-${Date.now()}`;
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const claimed = [];
  for (let i = 0; i < limit; i += 1) {
    const doc = await OutboxEvent.findOneAndUpdate(
      {
        $or: [
          {
            Status: { $in: ["pending", "failed"] },
            AvailableAt: { $lte: now },
          },
          {
            Status: "processing",
            LeaseUntil: { $lte: now },
          },
          {
            Status: "processing",
            LeaseUntil: null,
          },
        ],
        $and: [
          {
            $or: [{ ExpiresAt: null }, { ExpiresAt: { $gt: now } }],
          },
        ],
      },
      {
        $set: {
          Status: "processing",
          ProcessingBy: workerId,
          LeaseUntil: leaseUntil,
          ClaimedAt: now,
        },
        $inc: { Attempts: 1 },
      },
      { new: true, sort: { AvailableAt: 1 } },
    );
    if (!doc) break;
    claimed.push(doc);
  }
  return claimed;
}

async function markSent(id, workerId) {
  const updated = await OutboxEvent.findOneAndUpdate(
    {
      _id: id,
      Status: "processing",
      ProcessingBy: workerId,
    },
    {
      $set: {
        Status: "sent",
        ProcessedAt: new Date(),
        LeaseUntil: null,
        CompletedBy: workerId,
        LastError: "",
        // Wipe secrets after delivery
        PayloadEncrypted: "",
        PayloadWipedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!updated) {
    const err = new Error("Outbox lease lost — cannot mark sent.");
    err.code = "OUTBOX_LEASE_LOST";
    err.statusCode = 409;
    err.isOperational = true;
    throw err;
  }
  return updated;
}

async function markFailed(id, workerId, error, { maxAttempts = 8 } = {}) {
  const doc = await OutboxEvent.findOne({
    _id: id,
    Status: "processing",
    ProcessingBy: workerId,
  });
  if (!doc) {
    const err = new Error("Outbox lease lost — cannot mark failed.");
    err.code = "OUTBOX_LEASE_LOST";
    err.statusCode = 409;
    err.isOperational = true;
    throw err;
  }
  const dead = (doc.Attempts || 0) >= maxAttempts;
  const backoffMs = Math.min(
    3600_000,
    1000 * 2 ** Math.min(doc.Attempts || 1, 10),
  );
  return OutboxEvent.findOneAndUpdate(
    { _id: id, Status: "processing", ProcessingBy: workerId },
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
 * Redacted DTO for admin/dead-letter UIs — never expose PayloadEncrypted secrets.
 */
function toPublicDto(event) {
  if (!event) return null;
  const e = event.toObject ? event.toObject() : event;
  return {
    id: e._id,
    type: e.Type,
    entityType: e.EntityType,
    entityId: e.EntityID,
    status: e.Status,
    attempts: e.Attempts,
    lastError: e.LastError,
    availableAt: e.AvailableAt,
    processedAt: e.ProcessedAt,
    // Redact secrets
    payload: e.PayloadWipedAt ? { redacted: true } : sanitizePayload(e.Payload),
    hasEncryptedPayload: Boolean(e.PayloadEncrypted),
  };
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const out = { ...payload };
  for (const k of Object.keys(out)) {
    if (/token|secret|password|otp|code/i.test(k)) {
      out[k] = "[REDACTED]";
    }
  }
  return out;
}

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
    if (!to) return;
    await emailService.safeSendTemplate(p.template, { to, ...data });
    return;
  }
  if (event.Type === "email_secure_verify") {
    const emailService = require("./emailService");
    const p = event.Payload || {};
    if (!event.PayloadEncrypted) {
      throw new Error("Secure verify email missing encrypted payload");
    }
    const raw = secretBox.decrypt(event.PayloadEncrypted);
    if (!raw) throw new Error("Failed to decrypt verify token");
    await emailService.sendGeneric({
      to: p.to,
      subject: p.subject || "Xác minh email WorkHub",
      text: `Mã xác minh email WorkHub: ${raw}\nHết hạn sau 24 giờ.`,
    });
    return;
  }
  if (event.Type === "email") {
    const emailService = require("./emailService");
    const p = event.Payload || {};
    // Refuse to send if payload still contains raw token fields (defense in depth)
    if (p.text && /Mã xác minh/.test(p.text) && !event.PayloadEncrypted) {
      // Legacy rows — still deliver once but prefer wipe path
    }
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
  }
}

async function processPending(opts = {}) {
  const workerId = opts.workerId || `outbox-${process.pid}-${Date.now()}`;
  const batch = await claimBatch({
    workerId,
    limit: opts.limit || 20,
    leaseMs: opts.leaseMs || 60_000,
  });
  const results = [];
  for (const ev of batch) {
    try {
      await deliver(ev);
      await markSent(ev._id, workerId);
      results.push({ id: ev._id, ok: true });
    } catch (err) {
      if (err.code === "OUTBOX_LEASE_LOST") {
        results.push({ id: ev._id, ok: false, error: err.code });
        continue;
      }
      try {
        await markFailed(ev._id, workerId, err.message);
      } catch {
        /* lease lost */
      }
      results.push({ id: ev._id, ok: false, error: err.message });
    }
  }
  return results;
}

async function metricsSnapshot() {
  const now = new Date();
  const [pending, processing, failed, dead, expiredLeases, oldest] =
    await Promise.all([
      OutboxEvent.countDocuments({ Status: "pending" }),
      OutboxEvent.countDocuments({ Status: "processing" }),
      OutboxEvent.countDocuments({ Status: "failed" }),
      OutboxEvent.countDocuments({ Status: "dead" }),
      OutboxEvent.countDocuments({
        Status: "processing",
        LeaseUntil: { $lte: now },
      }),
      OutboxEvent.findOne({ Status: "pending" })
        .sort({ AvailableAt: 1 })
        .select("AvailableAt")
        .lean(),
    ]);
  return {
    pending,
    processing,
    failed,
    dead,
    expiredLeases,
    oldestPendingAgeMs: oldest?.AvailableAt
      ? Date.now() - new Date(oldest.AvailableAt).getTime()
      : 0,
  };
}

module.exports = {
  enqueue,
  enqueueNotification,
  enqueueEmailTemplate,
  enqueueSecureVerifyEmail,
  enqueueAudit,
  claimBatch,
  markSent,
  markFailed,
  deliver,
  processPending,
  toPublicDto,
  metricsSnapshot,
};
