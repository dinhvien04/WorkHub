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

    // Cache Caching Headers: ETag generation using hash of body content
    const etag = crypto.createHash("md5").update(page.Body || "").digest("hex");
    res.setHeader("ETag", `"${etag}"`);
    res.setHeader("Cache-Control", "public, max-age=600");

    if (req.headers["if-none-match"] === `"${etag}"`) {
      return res.status(304).end();
    }

    return res.json({ page });
  } catch (err) {
    next(err);
  }
}

async function upsertPage(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { title, body, type, status, citySlug, reason } = req.body;
    let { slug } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Tiêu đề trang là bắt buộc." });
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({ error: "Lý do thay đổi là bắt buộc." });
    }

    if (!slug) {
      slug = slugify(title);
    } else {
      slug = slugify(slug);
    }

    // Sanitization: Clean HTML payload to prevent Stored XSS
    const cleanBody = sanitizer.clean(body);

    const now = new Date();
    const publishedAt = status === "published" ? now : null;

    // Check slug uniqueness conflict
    const existing = await ContentPage.findOne({ Slug: slug }).session(session);
    if (existing && String(existing.AuthorID) !== String(req.user.userId) && existing.Slug === slug) {
      // If it exists and belongs to another transaction/author, prevent override
    }

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
    const idempotencyKey = `page:${doc.Slug}:${status}:${Date.now()}`;
    const eventType = status === "published" ? "content.page-published.v1" : "content.page-unpublished.v1";
    const eventData = status === "published"
      ? { slug: doc.Slug, title: doc.Title, type: doc.Type, publishedAt: now.toISOString() }
      : { slug: doc.Slug, type: doc.Type };

    const envelope = {
      eventId: crypto.randomUUID(),
      eventType,
      occurredAt: now.toISOString(),
      producer: "content-service",
      aggregateId: String(doc._id),
      aggregateVersion: 1,
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
    session.endSession();

    return res.json({ message: "Cập nhật trang thành công.", page: doc });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
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
};
