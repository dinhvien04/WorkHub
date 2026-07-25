"use strict";

const ContentPage = require("../models/ContentPage");
const AuditLog = require("../models/AuditLog");
const ContentOutbox = require("../models/ContentOutbox");
const sanitizer = require("../services/sanitizer");
const crypto = require("crypto");
const mongoose = require("mongoose");

// Helper to generate slug
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * Serializes a page document into a canonical JSON representation.
 */
function serializePageRepresentation(page) {
  return JSON.stringify({
    id: String(page._id || page.id),
    slug: page.Slug,
    type: page.Type,
    title: page.Title,
    body: page.Body || "",
    metaTitle: page.MetaTitle || "",
    metaDescription: page.MetaDescription || "",
    status: page.Status,
    publishedAt: page.PublishedAt ? new Date(page.PublishedAt).toISOString() : null,
    updatedAt: page.updatedAt ? new Date(page.updatedAt).toISOString() : null,
  });
}

/**
 * Computes a SHA-256 ETag from the canonical serialized representation.
 */
function computeEtag(page) {
  const representation = serializePageRepresentation(page);
  const hash = crypto.createHash("sha256").update(representation).digest("hex");
  return `"${hash}"`;
}

async function listPages(req, res, next) {
  try {
    const { page = 1, limit = 50, type = "guide", citySlug = "" } = req.query;

    const limitNum = parseInt(limit) || 50;
    const pageNum = parseInt(page) || 1;
    const skipIndex = (pageNum - 1) * limitNum;

    const query = { Status: "published", Type: type };
    if (citySlug) {
      query.CitySlug = citySlug;
    }

    const [items, total] = await Promise.all([
      ContentPage.find(query)
        .sort({ PublishedAt: -1 })
        .skip(skipIndex)
        .limit(limitNum)
        .lean(),
      ContentPage.countDocuments(query),
    ]);

    return res.json({
      pages: items,
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

async function getPage(req, res, next) {
  try {
    const { slug } = req.params;
    const page = await ContentPage.findOne({ Slug: slug, Status: "published" }).lean();

    if (!page) {
      return res.status(404).json({ error: "Không tìm thấy trang nội dung." });
    }

    // Generate ETag based on the entire serialized representation
    const etag = computeEtag(page);

    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=600");
    res.setHeader("Vary", "Accept-Language, Cookie, If-None-Match");

    if (page.updatedAt) {
      res.setHeader("Last-Modified", new Date(page.updatedAt).toUTCString());
    }

    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end(); // 304 Not Modified (empty body)
    }

    return res.json({ page });
  } catch (err) {
    next(err);
  }
}

async function upsertPage(req, res, next) {
  const { title, body, type, status, citySlug, reason } = req.body;
  let { slug } = req.body;

  // Validate inputs first before opening session
  if (!title) {
    return res.status(400).json({ error: "Tiêu đề trang là bắt buộc." });
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    return res.status(400).json({ error: "Lý do thay đổi là bắt buộc." });
  }

  if (status === "published") {
    const userScopes = req.user && req.user.scopes ? req.user.scopes : [];
    if (!userScopes.includes("content:publish")) {
      return res.status(403).json({ error: "Quyền truy cập bị từ chối. Thiếu scope: content:publish" });
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!slug) {
      slug = slugify(title);
    } else {
      slug = slugify(slug);
    }

    // 1. Optimistic Concurrency Check: If-Match validation
    const existing = await ContentPage.findOne({ Slug: slug }).session(session);
    const ifMatch = req.headers["if-match"];
    if (ifMatch && existing) {
      const currentEtag = computeEtag(existing);
      if (ifMatch !== currentEtag) {
        const err = new Error("Lỗi đè dữ liệu (If-Match Precondition Failed).");
        err.statusCode = 412;
        err.isOperational = true;
        throw err;
      }
    }

    // Sanitization: Clean HTML payload to prevent Stored XSS
    const cleanBody = sanitizer.clean(body);

    const now = new Date();
    const publishedAt = status === "published" ? now : null;

    const doc = await ContentPage.findOneAndUpdate(
      { Slug: slug },
      {
        $set: {
          Title: title,
          Body: cleanBody,
          Type: type || "guide",
          Status: status || "draft",
          CitySlug: citySlug || "",
          PublishedAt: publishedAt,
          AuthorID: req.user.userId,
        },
        $inc: { Version: 1 },
      },
      { upsert: true, new: true, session }
    );

    // Audit logs
    await AuditLog.create(
      [{
        ActorID: req.user.userId,
        Action: status === "published" ? "PUBLISH_PAGE" : "UPSERT_PAGE",
        TargetEntity: "ContentPage",
        TargetID: doc._id,
        Reason: reason,
      }],
      { session }
    );

    // Transactional Outbox integration: publish events
    const eventType = status === "published" ? "content.page-published.v1" : "content.page-unpublished.v1";
    const idempotencyKey = req.headers["x-idempotency-key"] || req.headers["idempotency-key"] || `${eventType}:${doc._id}:${doc.Version}`;
    const eventData = status === "published"
      ? { slug: doc.Slug, title: doc.Title, type: doc.Type, publishedAt: now.toISOString() }
      : { slug: doc.Slug, type: doc.Type };

    const envelope = {
      eventId: req.headers["x-idempotency-key"] || req.headers["idempotency-key"] || crypto.randomUUID(),
      eventType,
      occurredAt: now.toISOString(),
      producer: "content-service",
      aggregateId: String(doc._id),
      aggregateVersion: doc.Version,
      correlationId: crypto.randomUUID(),
      data: eventData,
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

    return res.json({ message: "Cập nhật trang thành công.", page: doc });
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (_) {}
    if (err.code === 11000 || (err.writeErrors && err.writeErrors.some(e => e.code === 11000))) {
      const currentDoc = await ContentPage.findOne({ Slug: slug });
      return res.json({ message: "Cập nhật trang thành công.", page: currentDoc });
    }
    next(err);
  } finally {
    session.endSession();
  }
}

async function deletePage(req, res, next) {
  try {
    const { slug } = req.params;
    const { reason } = req.body;

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({ error: "Lý do xóa trang là bắt buộc." });
    }

    const doc = await ContentPage.findOneAndDelete({ Slug: slug });
    if (!doc) {
      return res.status(404).json({ error: "Không tìm thấy trang cần xóa." });
    }

    await AuditLog.create({
      ActorID: req.user.userId,
      Action: "DELETE_PAGE",
      TargetEntity: "ContentPage",
      TargetID: doc._id,
      Reason: reason,
    });

    return res.json({ message: "Đã xóa trang thành công." });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPages,
  getPage,
  upsertPage,
  deletePage,
  computeEtag,
};
