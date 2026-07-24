"use strict";

const SeoRedirect = require("../models/SeoRedirect");
const AuditLog = require("../models/AuditLog");
const ContentOutbox = require("../models/ContentOutbox");
const mongoose = require("mongoose");
const crypto = require("crypto");

function isSafeInternalPath(path) {
  if (typeof path !== "string") return false;
  if (!path.startsWith("/")) return false;
  // Prevent protocol-relative redirects
  if (path.startsWith("//")) return false;
  // Disallow scheme structure (protocols like http:, javascript:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false;
  // Disallow carriage returns, line feeds, and null chars
  if (/[\r\n\0]/.test(path)) return false;
  // Max length limit
  if (path.length > 512) return false;
  return true;
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

    const redirect = await SeoRedirect.findOne({ FromPath: fromPath, Active: true }).lean();
    if (!redirect) {
      return res.status(404).json({ error: "Không tìm thấy cấu hình redirect." });
    }

    // Verify destination is still safe
    if (!isSafeInternalPath(redirect.ToPath)) {
      return res.status(400).json({ error: "Target redirect không an toàn." });
    }

    return res.json({ redirect });
  } catch (err) {
    next(err);
  }
}

async function upsertRedirect(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { fromPath, toPath, statusCode, active, note, reason } = req.body;

    if (!fromPath || !toPath) {
      return res.status(400).json({ error: "FromPath và ToPath là bắt buộc." });
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({ error: "Lý do thay đổi là bắt buộc." });
    }

    // Path safety validation
    if (!isSafeInternalPath(fromPath) || !isSafeInternalPath(toPath)) {
      return res.status(400).json({ error: "Đường dẫn không hợp lệ hoặc không an toàn." });
    }

    // Loop prevention: 1. Self Redirect loop check
    if (fromPath === toPath) {
      return res.status(400).json({ error: "FromPath và ToPath không được trùng (tránh vòng lặp)." });
    }

    // Loop prevention: 2. Two-step Loop check
    const reverse = await SeoRedirect.findOne({ FromPath: toPath, Active: true }).session(session);
    if (reverse && reverse.ToPath === fromPath) {
      return res.status(400).json({ error: "Redirect tạo vòng lặp 2 bước." });
    }

    const doc = await SeoRedirect.findOneAndUpdate(
      { FromPath: fromPath },
      {
        $set: {
          ToPath: toPath,
          StatusCode: statusCode || 301,
          Active: active !== false,
          Note: note || "",
        },
      },
      { upsert: true, new: true, session }
    );

    // Audit logs
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

    // Transactional Outbox: publish integration event
    const now = new Date();
    const eventType = "content.seo-redirect-updated.v1";
    const envelope = {
      eventId: crypto.randomUUID(),
      eventType,
      occurredAt: now.toISOString(),
      producer: "content-service",
      aggregateId: String(doc._id),
      aggregateVersion: 1,
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
        IdempotencyKey: `redirect:${doc.FromPath}:${doc.Active}:${Date.now()}`,
        AvailableAt: now,
      }],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({ message: "Cập nhật redirect thành công.", redirect: doc });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
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
};
