"use strict";

const asyncHandler = require("../utils/asyncHandler");
const { parsePagination, paginationMeta } = require("../utils/pagination");
const Space = require("../models/Space");
const Branch = require("../models/Branch");
const PricingRule = require("../models/PricingRule");
const Payout = require("../models/Payout");
const Refund = require("../models/Refund");

const refundService = require("../services/refundService");
const ledgerService = require("../services/ledgerService");
const pricingService = require("../services/pricingService");
const paymentService = require("../services/paymentService");
const gatewayService = require("../services/gatewayService");
const payoutService = require("../services/payoutService");
const membershipService = require("../services/membershipService");
const exportService = require("../services/exportService");
const jobQueue = require("../services/jobQueue");

const {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} = require("../utils/errors");
const schemas = require("../validators/schemas");

// —— Refunds ——
const requestRefund = asyncHandler(async (req, res) => {
  const body = schemas.parse(schemas.refundRequest, req.body);
  const key = req.get("Idempotency-Key");
  const refund = await refundService.requestRefund({
    bookingId: req.params.bookingId,
    userId: req.user.userId,
    role: req.user.role,
    amount: body.amount,
    reason: body.reason,
    idempotencyKey: key,
  });
  res.status(201).json({ refund });
});

const processRefund = asyncHandler(async (req, res) => {
  const refund = await refundService.processRefund({
    refundId: req.params.refundId,
    actorId: req.user.userId,
    approve: req.body.approve !== false,
    role: req.user.role,
    transferReference:
      req.body.transferReference || req.body.transferRef || null,
    evidence: req.body.evidence || "",
    submitProvider: req.body.submitProvider !== false,
  });
  res.json({ refund });
});

const listRefunds = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === "host") {
    filter.HostID = req.user.userId;
  } else if (req.user.role !== "admin") {
    filter.CustomerID = req.user.userId;
  }
  if (req.query.status) filter.Status = String(req.query.status);
  const items = await Refund.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(req.query.limit) || 50, 100))
    .lean();
  res.json({ refunds: items });
});

// —— Ledger / finance ——
const hostBalance = asyncHandler(async (req, res) => {
  const balance = await ledgerService.getHostBalance(req.user.userId);
  res.json({ balance });
});

const hostLedger = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const data = await ledgerService.listLedger(req.user.userId, { page, limit });
  res.json({ ...data, pagination: paginationMeta(data.total, page, limit) });
});

const verifyPaymentWithLedger = asyncHandler(async (req, res) => {
  const { payment } = await paymentService.verifyManualPaymentAndPostLedger({
    hostOwnerId: req.user.userId,
    actorUserId: req.user.userId,
    paymentId: req.params.paymentId,
  });
  res.json({ message: "Đã xác minh thanh toán.", payment });
});

// —— Quote pricing & Rules ——
const quote = asyncHandler(async (req, res) => {
  const { spaceId, startTime, endTime } = req.body;
  const space = await Space.findById(spaceId);
  if (!space) return res.status(404).json({ error: "Space not found" });
  const q = await pricingService.quotePrice({
    hostId: space.HostID,
    spaceId: space._id,
    branchId: space.BranchID,
    start: startTime,
    end: endTime,
    basePricePerHour: space.PricePerHour,
    durationPrices: {
      PricePerHalfDay: space.PricePerHalfDay,
      PricePerDay: space.PricePerDay,
      PricePerWeek: space.PricePerWeek,
      PricePerMonth: space.PricePerMonth,
    },
  });
  res.json(q);
});

const previewPricingRule = asyncHandler(async (req, res) => {
  const { spaceId, startTime, endTime, rule, draftRuleId } = req.body;
  const space = await Space.findById(spaceId);
  if (!space) return res.status(404).json({ error: "Space not found" });
  if (String(space.HostID) !== String(req.user.userId)) {
    return res
      .status(403)
      .json({ error: "Không có quyền preview rule cho space này." });
  }
  const result = await pricingService.previewPricingRule({
    hostId: space.HostID,
    spaceId: space._id,
    branchId: space.BranchID,
    start: startTime,
    end: endTime,
    basePricePerHour: space.PricePerHour,
    durationPrices: {
      PricePerHalfDay: space.PricePerHalfDay,
      PricePerDay: space.PricePerDay,
      PricePerWeek: space.PricePerWeek,
      PricePerMonth: space.PricePerMonth,
    },
    rule,
    draftRuleId: draftRuleId || null,
  });
  res.json({ preview: result });
});

const createPricingRule = asyncHandler(async (req, res) => {
  const status =
    req.body.status === "active" || req.body.publish === true
      ? "active"
      : "draft";
  let branchId = req.body.branchId || null;
  let spaceId = req.body.spaceId || null;

  if (branchId) {
    const branch = await Branch.findOne({
      _id: branchId,
      HostID: req.user.userId,
    }).select("_id");
    if (!branch) throw new NotFoundError("Branch không thuộc host hiện tại.");
    branchId = branch._id;
  }
  if (spaceId) {
    const space = await Space.findOne({
      _id: spaceId,
      HostID: req.user.userId,
    }).select("_id BranchID");
    if (!space) throw new NotFoundError("Space không thuộc host hiện tại.");
    if (branchId && String(space.BranchID) !== String(branchId)) {
      throw new ValidationError("Space không thuộc Branch đã chọn.");
    }
    if (!branchId) branchId = space.BranchID;
    spaceId = space._id;
  }

  const doc = await PricingRule.create({
    HostID: req.user.userId,
    BranchID: branchId,
    SpaceID: spaceId,
    Name: req.body.name,
    Type: req.body.type,
    Multiplier: Number(req.body.multiplier) || 1,
    FixedAdjust: Number(req.body.fixedAdjust) || 0,
    Priority: Number(req.body.priority) || 100,
    DayOfWeek: req.body.dayOfWeek || [],
    HourStart: req.body.hourStart ?? null,
    HourEnd: req.body.hourEnd ?? null,
    MinHours: req.body.minHours ?? null,
    Status: status,
  });
  res.status(201).json({ rule: doc });
});

const publishPricingRule = asyncHandler(async (req, res) => {
  const rule = await pricingService.publishPricingRule({
    hostId: req.user.userId,
    ruleId: req.params.ruleId,
  });
  res.json({ rule });
});

const listPricingRules = asyncHandler(async (req, res) => {
  const filter = { HostID: req.user.userId };
  if (req.query.status) filter.Status = req.query.status;
  const rules = await PricingRule.find(filter)
    .sort({ Priority: 1, createdAt: -1 })
    .lean();
  res.json({ rules });
});

// —— Gateway ——
const createCheckout = asyncHandler(async (req, res) => {
  const result = await gatewayService.createCheckoutSession({
    customerId: req.user.userId,
    bookingId: req.body.bookingId,
    paymentType: req.body.paymentType || "deposit",
    idempotencyKey: req.get("Idempotency-Key") || req.body.idempotencyKey,
  });
  res.status(201).json(result);
});

const gatewayWebhook = asyncHandler(async (req, res) => {
  let raw;
  if (Buffer.isBuffer(req.body)) {
    raw = req.body.toString("utf8");
  } else if (typeof req.body === "string") {
    raw = req.body;
  } else if (req.rawBody) {
    raw = Buffer.isBuffer(req.rawBody)
      ? req.rawBody.toString("utf8")
      : String(req.rawBody);
  } else {
    raw = JSON.stringify(req.body || {});
  }
  const signature =
    req.get("x-workhub-signature") ||
    req.get("x-webhook-signature") ||
    req.get("stripe-signature") ||
    req.get("x-momo-signature");
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    event = req.body;
  }
  const result = await gatewayService.handleWebhook({
    rawBody: raw,
    signature,
    event,
    provider: req.query.provider || req.get("x-payment-provider"),
  });
  res.json(result);
});

const listGatewayProviders = asyncHandler(async (req, res) => {
  res.json({ providers: await gatewayService.listProviders() });
});

const mockCompleteGateway = asyncHandler(async (req, res) => {
  const result = await gatewayService.mockCompleteSession(
    req.params.sessionId,
    req.user.userId,
  );
  res.json(result);
});

const getGatewaySession = asyncHandler(async (req, res) => {
  const dto = await gatewayService.getSessionForCustomer(
    req.params.sessionId,
    req.user.userId,
  );
  res.json(dto);
});

// —— Payout ——
const requestPayout = asyncHandler(async (req, res) => {
  const payout = await payoutService.requestPayout({
    hostId: req.user.userId,
    amount: req.body.amount,
    idempotencyKey: req.get("Idempotency-Key"),
  });
  res.status(201).json({ payout });
});

const listPayouts = asyncHandler(async (req, res) => {
  const items = await payoutService.listHostPayouts(req.user.userId);
  res.json({ payouts: items });
});

const adminProcessPayout = asyncHandler(async (req, res) => {
  const payout = await payoutService.processPayout({
    payoutId: req.params.payoutId,
    approve: req.body.approve !== false,
    adminId: req.user.userId,
    transferReference:
      req.body.transferReference || req.body.transferRef || null,
  });
  res.json({ payout });
});

const adminListPayouts = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.Status = String(req.query.status);
  const items = await Payout.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(req.query.limit) || 50, 100))
    .populate("HostID", "FullName Email")
    .lean();
  res.json({ payouts: items });
});

// —— Membership ——
const listPlans = asyncHandler(async (req, res) => {
  res.json({ plans: await membershipService.listPlans() });
});

const myMembership = asyncHandler(async (req, res) => {
  res.json({
    membership: await membershipService.getActiveMembership(req.user.userId),
  });
});

const subscribe = asyncHandler(async (req, res) => {
  const m = await membershipService.subscribe({
    userId: req.user.userId,
    planCode: req.body.planCode,
  });
  res.status(201).json({ membership: m });
});

const myCreditLedger = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const data = await membershipService.listCreditLedger(req.user.userId, {
    page,
    limit,
  });
  res.json({ ...data, pagination: paginationMeta(data.total, page, limit) });
});

// —— Exports & Jobs ——
const exportLedgerCsv = asyncHandler(async (req, res) => {
  const data = await ledgerService.listLedger(req.user.userId, {
    page: 1,
    limit: 500,
  });
  const csv = exportService.ledgerToCsv(data.items);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="workhub-ledger.csv"',
  );
  res.send(csv);
});

const enqueueLedgerExport = asyncHandler(async (req, res) => {
  const job = await jobQueue.enqueue({
    type: "export_ledger",
    queue: "exports",
    ownerUserId: req.user.userId,
    payload: { hostId: req.user.userId },
  });
  res.status(202).json({
    message: "Đã xếp hàng export ledger.",
    jobId: job._id,
    status: job.Status,
  });
});

const enqueueBookingsExport = asyncHandler(async (req, res) => {
  const job = await jobQueue.enqueue({
    type: "export_bookings",
    queue: "exports",
    ownerUserId: req.user.userId,
    payload: { hostId: req.user.userId },
  });
  res.status(202).json({
    message: "Đã xếp hàng export bookings.",
    jobId: job._id,
    status: job.Status,
  });
});

const getJobStatus = asyncHandler(async (req, res) => {
  const job = await jobQueue.getJob(req.params.jobId);
  if (!job) throw new NotFoundError("Job not found");
  if (
    req.user.role !== "admin" &&
    job.OwnerUserID &&
    String(job.OwnerUserID) !== String(req.user.userId)
  ) {
    throw new ForbiddenError("Không có quyền xem job này.");
  }
  res.json({ job });
});

const listMyJobs = asyncHandler(async (req, res) => {
  const jobs = await jobQueue.listJobsForUser(req.user.userId, { limit: 30 });
  res.json({ jobs });
});

const retryJob = asyncHandler(async (req, res) => {
  const existing = await jobQueue.getJob(req.params.jobId);
  if (!existing) throw new NotFoundError("Job not found");
  const isAdmin = req.user.role === "admin";
  const isOwner =
    existing.OwnerUserID &&
    String(existing.OwnerUserID) === String(req.user.userId);
  if (!isAdmin && !isOwner) {
    throw new ForbiddenError("Không có quyền retry job này.");
  }
  const SELF_SERVICE = new Set([
    "export_bookings",
    "export_payments",
    "export_ledger",
    "csv_export",
    "xlsx_export",
  ]);
  if (!isAdmin) {
    const t = String(existing.Type || existing.JobType || "");
    if (!SELF_SERVICE.has(t)) {
      throw new ForbiddenError(
        "Loại job này không cho phép self-service retry.",
      );
    }
  }
  const job = await jobQueue.retryFailedJob(req.params.jobId);
  res.json({ job });
});

const downloadJobFile = asyncHandler(async (req, res) => {
  const path = require("path");
  const fs = require("fs");
  const job = await jobQueue.getJob(req.params.jobId);
  if (!job) throw new NotFoundError("Job not found");
  if (
    req.user.role !== "admin" &&
    job.OwnerUserID &&
    String(job.OwnerUserID) !== String(req.user.userId)
  ) {
    throw new ForbiddenError("Không có quyền tải file job.");
  }
  if (job.Status !== "completed" || !job.Result?.file) {
    throw new ValidationError("Job chưa có file kết quả.");
  }
  const rel = String(job.Result.file).replace(/\\/g, "/");
  if (rel.includes("..") || !rel.startsWith("tmp/exports/")) {
    throw new ForbiddenError("Đường dẫn file không hợp lệ.");
  }
  const abs = path.join(process.cwd(), rel);
  if (!fs.existsSync(abs)) throw new NotFoundError("File không còn trên đĩa.");
  res.download(abs, path.basename(abs));
});

module.exports = {
  requestRefund,
  processRefund,
  listRefunds,
  hostBalance,
  hostLedger,
  verifyPaymentWithLedger,
  quote,
  previewPricingRule,
  createPricingRule,
  publishPricingRule,
  listPricingRules,
  createCheckout,
  gatewayWebhook,
  listGatewayProviders,
  mockCompleteGateway,
  getGatewaySession,
  requestPayout,
  listPayouts,
  adminProcessPayout,
  adminListPayouts,
  listPlans,
  myMembership,
  subscribe,
  myCreditLedger,
  exportLedgerCsv,
  enqueueLedgerExport,
  enqueueBookingsExport,
  getJobStatus,
  listMyJobs,
  retryJob,
  downloadJobFile,
};
