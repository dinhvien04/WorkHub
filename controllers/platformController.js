"use strict";

const asyncHandler = require("../utils/asyncHandler");
const { parsePagination, paginationMeta } = require("../utils/pagination");
const searchService = require("../services/searchService");
const rescheduleService = require("../services/rescheduleService");
const refundService = require("../services/refundService");
const disputeService = require("../services/disputeService");
const staffService = require("../services/staffService");
const ledgerService = require("../services/ledgerService");
const pricingService = require("../services/pricingService");
const cmsService = require("../services/cmsService");
const schemas = require("../validators/schemas");
const AddOn = require("../models/AddOn");
const Blackout = require("../models/Blackout");
const PricingRule = require("../models/PricingRule");
const SupportTicket = require("../models/SupportTicket");
const Incident = require("../models/Incident");
const Space = require("../models/Space");
const Branch = require("../models/Branch");
const Booking = require("../models/Booking");
const paymentService = require("../services/paymentService");
const { MembershipPlan } = require("../models/Membership");
const {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} = require("../utils/errors");

// —— Search ——
const search = asyncHandler(async (req, res) => {
  const data = await searchService.searchBranches(req.query);
  res.json(data);
});

const autocomplete = asyncHandler(async (req, res) => {
  const data = await searchService.autocomplete(req.query.q || "");
  res.json(data);
});

const searchFacets = asyncHandler(async (req, res) => {
  const data = await searchService.getSearchFacets();
  res.json(data);
});

const featured = asyncHandler(async (req, res) => {
  const featuredService = require("../services/featuredService");
  const [items, newest] = await Promise.all([
    featuredService.getFeaturedListings({ limit: req.query.limit }),
    featuredService.getNewListings({ limit: req.query.newLimit || 6 }),
  ]);
  res.json({ featured: items, newest });
});

// —— Reschedule ——
const reschedulePreview = asyncHandler(async (req, res) => {
  const body = schemas.parse(schemas.reschedule, {
    startTime: req.body.startTime || req.query.startTime,
    endTime: req.body.endTime || req.query.endTime,
  });
  const preview = await rescheduleService.previewReschedule({
    bookingId: req.params.bookingId,
    userId: req.user.userId,
    role: req.user.role,
    startTime: body.startTime,
    endTime: body.endTime,
  });
  res.json({ preview });
});

const reschedule = asyncHandler(async (req, res) => {
  const body = schemas.parse(schemas.reschedule, req.body);
  const result = await rescheduleService.rescheduleBooking({
    bookingId: req.params.bookingId,
    userId: req.user.userId,
    role: req.user.role,
    startTime: body.startTime,
    endTime: body.endTime,
  });
  const booking = result.booking || result;
  res.json({
    message: "Đã đổi lịch.",
    booking,
    previous: result.previous || null,
  });
});

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

// —— Staff ——
const listStaff = asyncHandler(async (req, res) => {
  const items = await staffService.listStaff(req.user.userId);
  res.json({ staff: items });
});

const inviteStaff = asyncHandler(async (req, res) => {
  const body = schemas.parse(schemas.staffInvite, req.body);
  const result = await staffService.inviteStaff({
    ownerId: req.user.userId,
    email: body.email,
    role: body.role,
    branchIds: body.branchIds,
  });
  res.status(201).json(result);
});

const acceptStaffInvite = asyncHandler(async (req, res) => {
  const staff = await staffService.acceptInvite({
    userId: req.user.userId,
    token: req.body.token,
  });
  res.json({ staff });
});

const revokeStaff = asyncHandler(async (req, res) => {
  const staff = await staffService.revokeStaff({
    ownerId: req.user.userId,
    staffId: req.params.staffId,
  });
  res.json({ staff });
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

// —— Quote pricing ——
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

/** Preview a draft/unsaved pricing rule before publish */
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

// —— Add-ons / blackouts / pricing rules (host) ——
const listAddOns = asyncHandler(async (req, res) => {
  const items = await AddOn.find({ HostID: req.user.userId })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ addOns: items });
});

const createAddOn = asyncHandler(async (req, res) => {
  let branchId = req.body.branchId || null;
  if (branchId) {
    const branch = await Branch.findOne({
      _id: branchId,
      HostID: req.user.userId,
    }).select("_id");
    if (!branch) {
      throw new NotFoundError("Branch không thuộc host hiện tại.");
    }
    branchId = branch._id;
  }
  // Host-global add-ons are explicit when branchId is omitted
  const doc = await AddOn.create({
    HostID: req.user.userId,
    BranchID: branchId,
    Name: req.body.name,
    Description: req.body.description || "",
    Price: Number(req.body.price) || 0,
    Unit: req.body.unit || "booking",
    Inventory: req.body.inventory ?? null,
    Refundable: req.body.refundable !== false,
  });
  res.status(201).json({ addOn: doc });
});

const createBlackout = asyncHandler(async (req, res) => {
  const hostBulkService = require("../services/hostBulkService");
  const result = await hostBulkService.createBlackoutWithNotify({
    hostId: req.user.userId,
    spaceId: req.body.spaceId,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    reason: req.body.reason || "maintenance",
    notifyCustomers: req.body.notifyCustomers !== false,
  });
  res.status(201).json(result);
});

const listBlackouts = asyncHandler(async (req, res) => {
  const items = await Blackout.find({ HostID: req.user.userId })
    .sort({ StartTime: -1 })
    .limit(100)
    .lean();
  res.json({ blackouts: items });
});

const deleteBlackout = asyncHandler(async (req, res) => {
  const hostBulkService = require("../services/hostBulkService");
  const result = await hostBulkService.deleteBlackout({
    hostId: req.user.userId,
    blackoutId: req.params.blackoutId,
  });
  res.json(result);
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

// —— Support ——
const createTicket = asyncHandler(async (req, res) => {
  const body = schemas.parse(schemas.supportTicket, req.body);
  let bookingId = body.bookingId || null;
  if (bookingId) {
    const booking = await Booking.findOne({
      _id: bookingId,
      CustomerID: req.user.userId,
    }).select("_id");
    if (!booking) {
      // 404 — do not leak other customers' booking existence
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

// —— Incidents ——
const createIncident = asyncHandler(async (req, res) => {
  // 1. Validation
  const allowedTypes = ["damage", "late_checkout", "violation", "other"];
  if (!req.body.type || !allowedTypes.includes(req.body.type)) {
    throw new ValidationError("Loại sự cố không hợp lệ hoặc thiếu.");
  }

  const description = req.body.description;
  if (
    !description ||
    typeof description !== "string" ||
    !description.trim() ||
    description.length >= 3000
  ) {
    throw new ValidationError(
      "Mô tả sự cố phải là chuỗi không trống và dưới 3000 ký tự.",
    );
  }

  if (!req.body.bookingId) {
    throw new ValidationError("bookingId là bắt buộc.");
  }

  const hostOwnerId = req.hostOwnerId;
  if (!hostOwnerId) {
    throw new ForbiddenError("Không tìm thấy thông tin hostOwnerId.");
  }

  // Verify staff permission 'incident:create'
  const { roleHas } = require("../policies/permissions");
  const role = req.hostContext?.staffRole || "owner";
  if (!roleHas(role, "incident:create")) {
    throw new ForbiddenError("Thiếu quyền: incident:create");
  }

  // 2. Retrieve Booking and check ownership using hostOwnerId
  const booking = await Booking.findOne({
    _id: req.body.bookingId,
    HostID: hostOwnerId,
  }).select("_id HostID SpaceID");
  if (!booking) {
    throw new NotFoundError("Booking không thuộc host hiện tại.");
  }

  // 3. Verify staff branch restrictions correctly using req.hostContext properties
  const space = await Space.findById(booking.SpaceID).select("BranchID").lean();
  const branchId = space?.BranchID ? String(space.BranchID) : null;

  if (req.hostContext && !req.hostContext.isOwner) {
    if (req.hostContext.allowedBranchIds !== null) {
      const allowed = (req.hostContext.allowedBranchIds || []).map(String);
      if (!branchId || !allowed.includes(branchId)) {
        throw new ForbiddenError(
          "Staff không có quyền trên branch của booking này.",
        );
      }
    }
  }

  // 4. Create Incident
  const doc = await Incident.create({
    BookingID: booking._id,
    HostID: hostOwnerId,
    ReportedBy: req.user.userId,
    Type: req.body.type,
    Description: description,
    InternalNote: req.body.internalNote || "",
    CustomerNote: req.body.customerNote || "",
  });

  res.status(201).json({ incident: doc });
});

// —— CMS ——
const listCms = asyncHandler(async (req, res) => {
  const data = await cmsService.listPublished(req.query);
  res.json(data);
});

const getCms = asyncHandler(async (req, res) => {
  const page = await cmsService.getBySlug(req.params.slug);
  res.json({ page });
});

const upsertCms = asyncHandler(async (req, res) => {
  const page = await cmsService.upsertPage(req.body, req.user.userId);
  res.json({ page });
});

// —— Membership ——
const listPlans = asyncHandler(async (req, res) => {
  const plans = await MembershipPlan.find({ Status: "active" }).lean();
  res.json({ plans });
});

const myMembership = asyncHandler(async (req, res) => {
  const membershipService = require("../services/membershipService");
  const m = await membershipService.getActiveMembership(req.user.userId);
  res.json({ membership: m });
});

const myCreditLedger = asyncHandler(async (req, res) => {
  const membershipService = require("../services/membershipService");
  const { page, limit } = parsePagination(req.query);
  const data = await membershipService.listCreditLedger(req.user.userId, {
    page,
    limit,
  });
  res.json({ ...data, pagination: paginationMeta(data.total, page, limit) });
});

// —— Feature flags ——
const flags = asyncHandler(async (req, res) => {
  const featureFlagService = require("../services/featureFlagService");
  const map = await featureFlagService.listPublicFlags({
    userId: req.user?.userId || null,
    role: req.user?.role || null,
  });
  res.json({ flags: map });
});

const adminListFlags = asyncHandler(async (req, res) => {
  const featureFlagService = require("../services/featureFlagService");
  res.json({ flags: await featureFlagService.listAllFlags() });
});

const adminUpsertFlag = asyncHandler(async (req, res) => {
  const featureFlagService = require("../services/featureFlagService");
  const flag = await featureFlagService.upsertFlag({
    key: req.body.key,
    enabled: req.body.enabled,
    description: req.body.description || "",
    percentage: req.body.percentage,
    roles: req.body.roles || [],
    environments: req.body.environments || [],
  });
  res.json({ flag });
});

// —— Bulk space status (legacy) + full bulk patch ——
const bulkSpaceStatus = asyncHandler(async (req, res) => {
  const hostBulkService = require("../services/hostBulkService");
  const result = await hostBulkService.bulkUpdateSpaces({
    hostId: req.user.userId,
    spaceIds: req.body.spaceIds || [],
    patch: { status: req.body.status },
  });
  res.json(result);
});

const bulkSpaces = asyncHandler(async (req, res) => {
  const hostBulkService = require("../services/hostBulkService");
  const {
    spaceIds,
    status,
    pricePerHour,
    depositAmount,
    amenities,
    instantBook,
    freeCancelHours,
    bufferBeforeMinutes,
    cleanupAfterMinutes,
  } = req.body;
  const result = await hostBulkService.bulkUpdateSpaces({
    hostId: req.user.userId,
    spaceIds: spaceIds || [],
    patch: {
      status,
      pricePerHour,
      depositAmount,
      amenities,
      instantBook,
      freeCancelHours,
      bufferBeforeMinutes,
      cleanupAfterMinutes,
    },
  });
  res.json(result);
});

const setBranchStatusHost = asyncHandler(async (req, res) => {
  const hostBulkService = require("../services/hostBulkService");
  const result = await hostBulkService.setBranchStatus({
    actorId: req.user.userId,
    role: "host",
    branchId: req.params.branchId,
    status: req.body.status,
    note: req.body.note,
  });
  res.json(result);
});

const setBranchPublishHost = asyncHandler(async (req, res) => {
  const hostBulkService = require("../services/hostBulkService");
  const result = await hostBulkService.setBranchPublishStatus({
    actorId: req.user.userId,
    role: req.user.role === "admin" ? "admin" : "host",
    branchId: req.params.branchId,
    publishStatus: req.body.publishStatus || req.body.status,
    note: req.body.note,
  });
  res.json(result);
});

// —— Reception today ——
const receptionToday = asyncHandler(async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const Booking = require("../models/Booking");
  const bookings = await Booking.find({
    HostID: req.user.userId,
    Status: { $in: ["confirmed", "in-use", "pending", "payment_under_review"] },
    StartTime: { $lte: end },
    EndTime: { $gte: start },
  })
    .populate("CustomerID", "FullName Email")
    .populate("SpaceID", "Name SpaceCode")
    .sort({ StartTime: 1 })
    .lean();
  res.json({ bookings });
});

// —— Checkout ——
const checkout = asyncHandler(async (req, res) => {
  const Booking = require("../models/Booking");
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.bookingId, HostID: req.user.userId, Status: "in-use" },
    { $set: { Status: "completed", CheckOutAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!booking) return res.status(404).json({ error: "Không check-out được." });
  res.json({ booking });
});

// Canonical verify path (alias kept for API compatibility)
const verifyPaymentWithLedger = asyncHandler(async (req, res) => {
  const { payment } = await paymentService.verifyManualPaymentAndPostLedger({
    hostOwnerId: req.user.userId,
    actorUserId: req.user.userId,
    paymentId: req.params.paymentId,
  });
  res.json({ message: "Đã xác minh thanh toán.", payment });
});

module.exports = {
  search,
  autocomplete,
  searchFacets,
  featured,
  reschedule,
  reschedulePreview,
  requestRefund,
  processRefund,
  openDispute,
  listDisputes,
  resolveDispute,
  listStaff,
  inviteStaff,
  acceptStaffInvite,
  revokeStaff,
  hostBalance,
  hostLedger,
  quote,
  previewPricingRule,
  listAddOns,
  createAddOn,
  createBlackout,
  listBlackouts,
  deleteBlackout,
  createPricingRule,
  publishPricingRule,
  listPricingRules,
  createTicket,
  listTickets,
  createIncident,
  listCms,
  getCms,
  upsertCms,
  listPlans,
  myMembership,
  myCreditLedger,
  flags,
  adminListFlags,
  adminUpsertFlag,
  bulkSpaceStatus,
  bulkSpaces,
  setBranchStatusHost,
  setBranchPublishHost,
  receptionToday,
  checkout,
  verifyPaymentWithLedger,
};
