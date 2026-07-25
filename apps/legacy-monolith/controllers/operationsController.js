"use strict";

const asyncHandler = require("../utils/asyncHandler");
const { parsePagination, paginationMeta } = require("../utils/pagination");
const disputeService = require("../services/disputeService");
const SupportTicket = require("../models/SupportTicket");
const Booking = require("../models/Booking");
const User = require("../models/User");
const fraudService = require("../services/fraudService");
const jobQueue = require("../services/jobQueue");
const paymentService = require("../services/paymentService");
const payoutService = require("../services/payoutService");
const SeoRedirect = require("../models/SeoRedirect");

const {
  NotFoundError,
  ValidationError,
} = require("../utils/errors");
const schemas = require("../validators/schemas");

// —— Disputes ——
const openDispute = asyncHandler(async (req, res) => {
  const body = schemas.parse(schemas.disputeOpen, req.body);
  const d = await disputeService.openDispute({
    bookingId: req.params.bookingId,
    userId: req.user.userId,
    reason: body.reason,
  });
  res.status(201).json({ dispute: d });
});

const listDisputes = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const data = await disputeService.listDisputes({
    role: req.user.role,
    userId: req.user.userId,
    status: req.query.status,
    page,
    limit,
  });
  res.json({
    disputes: data.items,
    pagination: paginationMeta(data.total, page, limit),
  });
});

const resolveDispute = asyncHandler(async (req, res) => {
  const d = await disputeService.resolveDispute({
    disputeId: req.params.disputeId,
    adminId: req.user.userId,
    resolution: req.body.resolution,
    refundAmount: req.body.refundAmount,
    reject: !!req.body.reject,
  });
  res.json({ dispute: d });
});

// —— Support Tickets ——
const createTicket = asyncHandler(async (req, res) => {
  const body = schemas.parse(schemas.supportTicket, req.body);
  let bookingId = body.bookingId || null;
  if (bookingId) {
    const booking = await Booking.findOne({
      _id: bookingId,
      CustomerID: req.user.userId,
    }).select("_id");
    if (!booking) {
      throw new NotFoundError("Booking không tồn tại.");
    }
    bookingId = booking._id;
  }
  const t = await SupportTicket.create({
    UserID: req.user.userId,
    BookingID: bookingId,
    Subject: body.subject,
    Body: body.body,
  });
  res.status(201).json({ ticket: t });
});

const listTickets = asyncHandler(async (req, res) => {
  const filter = req.user.role === "admin" ? {} : { UserID: req.user.userId };
  const items = await SupportTicket.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ tickets: items });
});

// —— Fraud ——
const fraudPreview = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId).lean();
  const recent = await Booking.countDocuments({
    CustomerID: req.user.userId,
    createdAt: { $gte: new Date(Date.now() - 3600000) },
  });
  const result = fraudService.scoreBookingAttempt({
    userCreatedAt: user?.createdAt,
    amount: Number(req.body.amount) || 0,
    recentBookingCount: recent,
    recentFailedPayments: Number(req.body.recentFailedPayments) || 0,
    ipVelocity: Number(req.body.ipVelocity) || 0,
  });
  res.json(result);
});

// —— RUM / Web Vitals beacon ——
const rumBeacon = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (require("../config/env").isProduction && Math.random() > 0.2) {
    return res.status(204).end();
  }
  const clamp = (n, max) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return null;
    return Math.min(v, max);
  };
  const metrics = {
    lcp: clamp(body.lcp, 120_000),
    inp: clamp(body.inp, 60_000),
    cls: clamp(body.cls, 10),
    ttfb: clamp(body.ttfb, 60_000),
    fcp: clamp(body.fcp, 120_000),
    path: String(body.path || "").slice(0, 200),
    navType: String(body.navType || "").slice(0, 40),
  };
  try {
    require("../utils/logger").info({ rum: metrics }, "web-vitals");
  } catch {
    /* ignore */
  }
  res.status(204).end();
});

// —— Host Reporting Advanced ——
const hostAdvancedReport = asyncHandler(async (req, res) => {
  const metrics = await paymentService.getHostRevenueMetrics(req.user.userId);
  const balance = await require("../services/ledgerService").getHostBalance(
    req.user.userId,
  );
  const payouts = await payoutService.listHostPayouts(req.user.userId);
  res.json({
    revenue: metrics,
    balance,
    payoutsSummary: {
      count: payouts.length,
      paid: payouts
        .filter((p) => p.Status === "paid")
        .reduce((s, p) => s + p.Amount, 0),
    },
  });
});

// —— System Health (Admin) ——
const systemHealth = asyncHandler(async (req, res) => {
  const mongoose = require("mongoose");
  const pkg = require("../package.json");
  const mem = process.memoryUsage();
  let redis = {
    configured: Boolean(process.env.REDIS_URL),
    ok: false,
    mode: "none",
  };
  if (process.env.REDIS_URL) {
    try {
      const { getRateLimitStore } = require("../utils/rateLimitStore");
      await getRateLimitStore(1000);
      redis = { configured: true, ok: true, mode: "redis_or_memory_fallback" };
    } catch (e) {
      redis = { configured: true, ok: false, error: e.message };
    }
  } else {
    redis = { configured: false, ok: true, mode: "memory" };
  }
  res.json({
    status: mongoose.connection.readyState === 1 ? "ok" : "degraded",
    version: pkg.version,
    node: process.version,
    uptimeSec: Math.round(process.uptime()),
    db: { readyState: mongoose.connection.readyState },
    redis,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
    },
    env: process.env.NODE_ENV || "development",
    useTailwindCdn: process.env.USE_TAILWIND_CDN,
    paymentProvider: process.env.PAYMENT_PROVIDER || "workhub_mock",
    timestamp: new Date().toISOString(),
  });
});

// —— SEO Redirect Admin ——
const upsertSeoRedirect = asyncHandler(async (req, res) => {
  const { isSafeInternalPath } = require("../utils/publicBaseUrl");
  const from = String(req.body.fromPath || "").trim();
  const to = String(req.body.toPath || "").trim();
  if (!from || !to) throw new ValidationError("fromPath và toPath bắt buộc.");
  if (!isSafeInternalPath(from) || !isSafeInternalPath(to)) {
    throw new ValidationError(
      "Redirect chỉ cho phép path nội bộ (bắt đầu /, không //, không scheme).",
    );
  }
  if (from === to) {
    throw new ValidationError(
      "fromPath và toPath không được trùng (tránh loop).",
    );
  }
  const reverse = await SeoRedirect.findOne({
    FromPath: to,
    Active: true,
  }).lean();
  if (reverse && reverse.ToPath === from) {
    throw new ValidationError("Redirect tạo vòng lặp 2 bước.");
  }
  const doc = await SeoRedirect.findOneAndUpdate(
    { FromPath: from },
    {
      $set: {
        ToPath: to,
        StatusCode: req.body.statusCode === 302 ? 302 : 301,
        Active: req.body.active !== false,
        Note: req.body.note || "",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json({ redirect: doc });
});

const listSeoRedirects = asyncHandler(async (req, res) => {
  res.json({
    redirects: await SeoRedirect.find().sort({ FromPath: 1 }).lean(),
  });
});

const deleteSeoRedirect = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const fromPath = req.query?.fromPath || (req.body && req.body.fromPath);
  let doc;
  if (id && String(id).match(/^[a-f\d]{24}$/i)) {
    doc = await SeoRedirect.findByIdAndDelete(id);
  } else if (fromPath) {
    doc = await SeoRedirect.findOneAndDelete({
      FromPath: String(fromPath).trim(),
    });
  } else {
    throw new ValidationError("Thiếu id hoặc fromPath.");
  }
  if (!doc) throw new NotFoundError("Không tìm thấy redirect.");
  res.json({ deleted: true, redirect: doc });
});

const toggleSeoRedirect = asyncHandler(async (req, res) => {
  const doc = await SeoRedirect.findById(req.params.id);
  if (!doc) throw new NotFoundError("Không tìm thấy redirect.");
  doc.Active =
    typeof req.body.active === "boolean" ? req.body.active : !doc.Active;
  await doc.save();
  res.json({ redirect: doc });
});

// —— Dead letters admin ——
const listDeadLetters = asyncHandler(async (req, res) => {
  const items = await jobQueue.listDeadLetters({ limit: 50 });
  res.json({ items });
});

const discardDeadLetter = asyncHandler(async (req, res) => {
  const doc = await jobQueue.discardDeadLetter(req.params.id);
  if (!doc) throw new NotFoundError("Dead letter not found");
  res.json({ item: doc });
});

const replayDeadLetter = asyncHandler(async (req, res) => {
  const result = await jobQueue.replayDeadLetter(req.params.id);
  res.json(result);
});

module.exports = {
  openDispute,
  listDisputes,
  resolveDispute,
  createTicket,
  listTickets,
  fraudPreview,
  rumBeacon,
  hostAdvancedReport,
  systemHealth,
  listSeoRedirects,
  upsertSeoRedirect,
  deleteSeoRedirect,
  toggleSeoRedirect,
  listDeadLetters,
  replayDeadLetter,
  discardDeadLetter,
};
