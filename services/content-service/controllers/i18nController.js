"use strict";

const Translation = require("../models/Translation");
const AuditLog = require("../models/AuditLog");
const ContentOutbox = require("../models/ContentOutbox");
const mongoose = require("mongoose");
const crypto = require("crypto");

const ALLOWED_LOCALES = ["vi", "en"];

async function getTranslationBundle(req, res, next) {
  try {
    const lang = String(req.query.lang || req.cookies?.lang || "vi").toLowerCase();

    if (!ALLOWED_LOCALES.includes(lang)) {
      return res.status(400).json({ error: "Ngôn ngữ không được hỗ trợ." });
    }

    const translations = await Translation.find({ Locale: lang }).lean();

    // Map array into a flat dictionary object key-value
    const messages = {};
    translations.forEach((t) => {
      messages[t.Key] = t.Value;
    });

    return res.json({ lang, messages });
  } catch (err) {
    next(err);
  }
}

async function upsertTranslation(req, res, next) {
  const { locale, key, value, reason } = req.body;

  if (!locale || !key || value === undefined) {
    return res.status(400).json({ error: "Locale, Key và Value là bắt buộc." });
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    return res.status(400).json({ error: "Lý do thay đổi là bắt buộc." });
  }

  const cleanLocale = String(locale).toLowerCase();
  if (!ALLOWED_LOCALES.includes(cleanLocale)) {
    return res.status(400).json({ error: "Ngôn ngữ không được hỗ trợ." });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const doc = await Translation.findOneAndUpdate(
      { Locale: cleanLocale, Key: key },
      {
        $set: { Value: String(value) },
        $inc: { Version: 1 }
      },
      { upsert: true, new: true, session }
    );

    // Audit logs
    await AuditLog.create(
      [{
        ActorID: req.user.userId,
        Action: "UPDATE_TRANSLATION",
        TargetEntity: "Translation",
        TargetID: doc._id,
        Reason: reason,
      }],
      { session }
    );

    // Transactional Outbox: publish translation-updated event
    const now = new Date();
    const eventType = "content.translation-updated.v1";
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
        locale: doc.Locale,
        key: doc.Key,
        value: doc.Value,
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

    return res.json({ message: "Cập nhật dịch thuật thành công.", translation: doc });
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (_) {}
    if (err.code === 11000 || (err.writeErrors && err.writeErrors.some(e => e.code === 11000))) {
      const currentDoc = await Translation.findOne({ Locale: cleanLocale, Key: key });
      return res.json({ message: "Cập nhật dịch thuật thành công.", translation: currentDoc });
    }
    next(err);
  } finally {
    session.endSession();
  }
}

module.exports = {
  getTranslationBundle,
  upsertTranslation,
};
