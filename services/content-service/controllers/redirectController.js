"use strict";

const SeoRedirect = require("../models/SeoRedirect");
const AuditLog = require("../models/AuditLog");
const ContentOutbox = require("../models/ContentOutbox");
const mongoose = require("mongoose");
const crypto = require("crypto");

/**
 * Safely decodes, normalizes slashes, resolves dot segments, and rejects external schemes.
 */
function canonicalizePath(p) {
  if (typeof p !== "string") return null;
  let decoded = p;

  try {
    // Decode percent encoding recursively to expose obfuscated inputs (e.g. %252f)
    let prev;
    let iterations = 0;
    do {
      prev = decoded;
      decoded = decodeURIComponent(decoded);
      iterations++;
    } while (decoded !== prev && iterations < 5);
  } catch (e) {
    // Keep raw on malformed URI
  }

  // Normalize backslashes to forward slashes
  decoded = decoded.replace(/\\/g, "/");

  // Reject control characters and null bytes
  if (/[\r\n\0]/.test(decoded)) return null;

  // Reject scheme/protocol structures (e.g. http:, https:, javascript:, data:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return null;

  // Reject scheme-relative slashes
  if (decoded.startsWith("//")) return null;

  // Resolve dot segments (/./ and /../)
  const segments = decoded.split("/");
  const stack = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") {
      continue;
    }
    if (segment === "..") {
      stack.pop();
    } else {
      stack.push(segment);
    }
  }

  return "/" + stack.join("/");
}

function isSafeInternalPath(path) {
  if (typeof path !== "string") return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;

  const canonical = canonicalizePath(path);
  if (!canonical) return false;

  // Enforce strict equality with its canonicalized representation
  return path === canonical;
}

/**
 * Arbitrary-depth redirect cycle and chain-length validator.
 * Limits traversal to a maximum of 20 hops to prevent infinite loops.
 */
async function detectRedirectCycle(startPath, targetPath, session = null) {
  const maxHops = 20;
  const visited = new Set([startPath]);

  let current = targetPath;
  let hops = 0;

  while (current && hops < maxHops) {
    if (visited.has(current)) {
      return { hasCycle: true, reason: "Chuyển hướng vòng lặp vô hạn" };
    }
    visited.add(current);

    const query = SeoRedirect.findOne({ FromPath: current, Active: true });
    if (session) query.session(session);
    const nextRedirect = await query.lean();

    if (!nextRedirect) {
      break; // Safe terminal endpoint reached
    }

    current = nextRedirect.ToPath;
    hops++;
  }

  if (hops >= maxHops) {
    return { hasCycle: true, reason: `Độ dài chuỗi chuyển hướng vượt quá giới hạn cho phép (${maxHops} bước).` };
  }

  return { hasCycle: false };
}

async function listRedirects(req, res, next) {
  try {
    const { page = 1, limit = 50, activeOnly = "false" } = req.query;
    const limitNum = parseInt(limit) || 50;
    const pageNum = parseInt(page) || 1;
    const skipIndex = (pageNum - 1) * limitNum;

    const query = {};
    if (activeOnly === "true") {
      query.Active = true;
    }

    const [items, total] = await Promise.all([
      SeoRedirect.find(query)
        .sort({ createdAt: -1 })
        .skip(skipIndex)
        .limit(limitNum)
        .lean(),
      SeoRedirect.countDocuments(query),
    ]);

    return res.json({
      redirects: items,
      pagination: {
        total,
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        limit: limitNum,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getRedirectByPath(req, res, next) {
  try {
    const { fromPath } = req.query;
    if (!fromPath) {
      return res.status(400).json({ error: "Thiếu đường dẫn cần tìm." });
    }

    const canonicalFrom = canonicalizePath(fromPath);
    if (!canonicalFrom) {
      return res.status(400).json({ error: "Đường dẫn đầu vào không an toàn." });
    }

    const redirect = await SeoRedirect.findOne({ FromPath: canonicalFrom, Active: true }).lean();
    if (!redirect) {
      return res.status(404).json({ error: "Không tìm thấy cấu hình redirect." });
    }

    if (!isSafeInternalPath(redirect.ToPath)) {
      return res.status(400).json({ error: "Target redirect không an toàn." });
    }

    return res.json({ redirect });
  } catch (err) {
    next(err);
  }
}

async function upsertRedirect(req, res, next) {
  const { fromPath, toPath, statusCode, active, note, reason } = req.body;

  if (!fromPath || !toPath) {
    return res.status(400).json({ error: "FromPath và ToPath là bắt buộc." });
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    return res.status(400).json({ error: "Lý do thay đổi là bắt buộc." });
  }

  // Canonicalize paths
  const canonicalFrom = canonicalizePath(fromPath);
  const canonicalTo = canonicalizePath(toPath);

  if (!canonicalFrom || !canonicalTo || !isSafeInternalPath(canonicalFrom) || !isSafeInternalPath(canonicalTo)) {
    return res.status(400).json({ error: "Đường dẫn không hợp lệ hoặc không an toàn." });
  }

  // Self Loop Check
  if (canonicalFrom === canonicalTo) {
    return res.status(400).json({ error: "FromPath và ToPath không được trùng (tránh vòng lặp)." });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Arbitrary-depth loop / cycle check
    const cycleCheck = await detectRedirectCycle(canonicalFrom, canonicalTo, session);
    if (cycleCheck.hasCycle) {
      const err = new Error(`Không thể tạo redirect: ${cycleCheck.reason}`);
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }

    // Optimistic check to ensure transaction-safety
    const doc = await SeoRedirect.findOneAndUpdate(
      { FromPath: canonicalFrom },
      {
        $set: {
          ToPath: canonicalTo,
          StatusCode: statusCode || 301,
          Active: active !== false,
          Note: note || "",
        },
        $inc: { Version: 1 },
      },
      { upsert: true, new: true, session }
    );

    // Audit log
    await AuditLog.create(
      [{
        ActorID: req.user.userId,
        Action: "UPSERT_REDIRECT",
        TargetEntity: "SeoRedirect",
        TargetID: doc._id,
        Reason: reason,
      }],
      { session }
    );

    // Transactional Outbox
    const now = new Date();
    const eventType = "content.seo-redirect-updated.v1";
    const idempotencyKey = req.headers["x-idempotency-key"] || req.headers["idempotency-key"] || `${eventType}:${doc._id}:${doc.Version}`;
    const envelope = {
      eventId: req.headers["x-idempotency-key"] || req.headers["idempotency-key"] || crypto.randomUUID(),
      eventType,
      occurredAt: now.toISOString(),
      producer: "content-service",
      aggregateId: String(doc._id),
      aggregateVersion: doc.Version,
      correlationId: crypto.randomUUID(),
      data: {
        fromPath: doc.FromPath,
        toPath: doc.ToPath,
        statusCode: doc.StatusCode,
        active: doc.Active,
      },
    };

    await ContentOutbox.create(
      [{
        Type: eventType,
        Payload: envelope,
        Status: "pending",
        IdempotencyKey: idempotencyKey,
        AvailableAt: now,
      }],
      { session }
    );

    await session.commitTransaction();

    return res.json({ message: "Cập nhật redirect thành công.", redirect: doc });
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (_) {}
    if (err.code === 11000 || (err.writeErrors && err.writeErrors.some(e => e.code === 11000))) {
      const currentDoc = await SeoRedirect.findOne({ FromPath: canonicalFrom });
      return res.json({ message: "Cập nhật redirect thành công.", redirect: currentDoc });
    }
    next(err);
  } finally {
    session.endSession();
  }
}

async function deleteRedirect(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({ error: "Lý do xóa redirect là bắt buộc." });
    }

    const doc = await SeoRedirect.findByIdAndDelete(id);
    if (!doc) {
      return res.status(404).json({ error: "Không tìm thấy redirect cần xóa." });
    }

    await AuditLog.create({
      ActorID: req.user.userId,
      Action: "DELETE_REDIRECT",
      TargetEntity: "SeoRedirect",
      TargetID: doc._id,
      Reason: reason,
    });

    return res.json({ message: "Đã xóa redirect thành công." });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listRedirects,
  getRedirectByPath,
  upsertRedirect,
  deleteRedirect,
  canonicalizePath,
  isSafeInternalPath,
};
