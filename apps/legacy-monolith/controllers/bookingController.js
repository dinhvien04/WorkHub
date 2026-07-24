"use strict";

const asyncHandler = require("../utils/asyncHandler");
const schemas = require("../validators/schemas");
const Booking = require("../models/Booking");
const Space = require("../models/Space");
const Branch = require("../models/Branch");
const AddOn = require("../models/AddOn");
const Blackout = require("../models/Blackout");
const Incident = require("../models/Incident");
const PaymentHistory = require("../models/Payment_History");

const rescheduleService = require("../services/rescheduleService");
const hostBulkService = require("../services/hostBulkService");
const recurringService = require("../services/recurringService");
const groupBookingService = require("../services/groupBookingService");
const checkInService = require("../services/checkInService");
const calendarService = require("../services/calendarService");
const bookingService = require("../services/bookingService");
const customerDashboardService = require("../services/customerDashboardService");
const availabilityService = require("../services/availabilityService");
const bookingQuoteService = require("../services/bookingQuoteService");
const cancellationPolicyService = require("../services/cancellationPolicyService");
const exportService = require("../services/exportService");
const staffService = require("../services/staffService");
const hostInboxService = require("../services/hostInboxService");
const onboardingService = require("../services/onboardingService");
const bookingTimelineService = require("../services/bookingTimelineService");

const {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} = require("../utils/errors");

const { presentBooking } = require("../presenters/bookingPresenter");

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

// —— Incidents ——
const createIncident = asyncHandler(async (req, res) => {
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

  const { roleHas } = require("../policies/permissions");
  const role = req.hostContext?.staffRole || "owner";
  if (!roleHas(role, "incident:create")) {
    throw new ForbiddenError("Thiếu quyền: incident:create");
  }

  const booking = await Booking.findOne({
    _id: req.body.bookingId,
    HostID: hostOwnerId,
  }).select("_id HostID SpaceID");
  if (!booking) {
    throw new NotFoundError("Booking không thuộc host hiện tại.");
  }

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

// —— Reception today ——
const receptionToday = asyncHandler(async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
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
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.bookingId, HostID: req.user.userId, Status: "in-use" },
    { $set: { Status: "completed", CheckOutAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!booking) return res.status(404).json({ error: "Không check-out được." });
  res.json({ booking });
});

// —— Bulk updates ——
const bulkSpaceStatus = asyncHandler(async (req, res) => {
  const result = await hostBulkService.bulkUpdateSpaces({
    hostId: req.user.userId,
    spaceIds: req.body.spaceIds || [],
    patch: { status: req.body.status },
  });
  res.json(result);
});

const bulkSpaces = asyncHandler(async (req, res) => {
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

// —— Blackouts ——
const listBlackouts = asyncHandler(async (req, res) => {
  const items = await Blackout.find({ HostID: req.user.userId })
    .sort({ StartTime: -1 })
    .limit(100)
    .lean();
  res.json({ blackouts: items });
});

const createBlackout = asyncHandler(async (req, res) => {
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

const deleteBlackout = asyncHandler(async (req, res) => {
  const result = await hostBulkService.deleteBlackout({
    hostId: req.user.userId,
    blackoutId: req.params.blackoutId,
  });
  res.json(result);
});

// —— Add-ons (host) ——
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

// —— Recurring bookings ——
const previewRecurring = asyncHandler(async (req, res) => {
  const body = { ...req.body, ...req.query };
  const preview = await recurringService.previewSeries({
    spaceId: body.spaceId,
    frequency: body.frequency,
    interval: body.interval,
    daysOfWeek: body.daysOfWeek
      ? Array.isArray(body.daysOfWeek)
        ? body.daysOfWeek
        : String(body.daysOfWeek).split(",").map(Number)
      : [],
    startTimeOfDay: body.startTimeOfDay,
    durationMinutes: body.durationMinutes,
    seriesStart: body.seriesStart,
    seriesEnd: body.seriesEnd,
    occurrenceCount: body.occurrenceCount,
  });
  res.json({ preview });
});

const createRecurring = asyncHandler(async (req, res) => {
  const space = await Space.findById(req.body.spaceId);
  if (!space) throw new NotFoundError("Space not found");
  const idempotencyKey = req.get("Idempotency-Key") || req.body.idempotencyKey;
  if (!idempotencyKey) {
    throw new ValidationError(
      "Idempotency-Key là bắt buộc cho recurring series.",
    );
  }
  const result = await recurringService.createSeries({
    customerId: req.user.userId,
    spaceId: space._id,
    hostId: space.HostID,
    frequency: req.body.frequency,
    interval: req.body.interval,
    daysOfWeek: req.body.daysOfWeek,
    startTimeOfDay: req.body.startTimeOfDay,
    durationMinutes: req.body.durationMinutes,
    seriesStart: req.body.seriesStart,
    seriesEnd: req.body.seriesEnd,
    occurrenceCount: req.body.occurrenceCount,
    idempotencyKey,
  });
  res.status(201).json(result);
});

const listRecurring = asyncHandler(async (req, res) => {
  const items = await recurringService.listSeries(req.user.userId);
  res.json({ series: items });
});

const cancelRecurring = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await recurringService.cancelSeries(
    req.params.seriesId,
    req.user.userId,
    {
      mode: body.mode || req.query.mode || "whole",
      occurrenceBookingId:
        body.occurrenceBookingId || req.query.occurrenceBookingId || null,
    },
  );
  res.json({ ...result, message: "Đã hủy series/occurrence." });
});

// —— Group bookings ——
const createGroupBooking = asyncHandler(async (req, res) => {
  const result = await groupBookingService.createGroupBooking({
    customerId: req.user.userId,
    spaceId: req.body.spaceId,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    note: req.body.note || "",
    corporateName: req.body.corporateName || "",
    attendees: req.body.attendees || [],
    addOns: req.body.addOns || [],
    couponCode: req.body.couponCode || null,
  });
  res.status(201).json(result);
});

const listGroupInvites = asyncHandler(async (req, res) => {
  const invites = await groupBookingService.listInvitesForBooking({
    bookingId: req.params.bookingId,
    userId: req.user.userId,
  });
  res.json({ invites });
});

const getGroupInvitePublic = asyncHandler(async (req, res) => {
  const data = await groupBookingService.getInviteByToken(req.params.token);
  res.json(data);
});

const rsvpGroupInvite = asyncHandler(async (req, res) => {
  const invite = await groupBookingService.rsvpByToken({
    token: req.params.token,
    status: req.body.status,
    note: req.body.note,
  });
  res.json({ invite, message: "Đã ghi nhận RSVP." });
});

// —— QR check-in / no-show ——
const mintCheckIn = asyncHandler(async (req, res) => {
  const result = await checkInService.mintCheckInToken({
    bookingId: req.params.bookingId,
    actorId: req.user.userId,
    actorRole: req.user.role,
  });
  res.json(result);
});

const scanCheckIn = asyncHandler(async (req, res) => {
  const booking = await checkInService.checkInWithToken({
    hostId: req.user.userId,
    token: req.body.token,
    code: req.body.code,
    hostContext: { isOwner: true, allowedBranchIds: null },
  });
  res.json({ booking, message: "Check-in thành công." });
});

const markNoShow = asyncHandler(async (req, res) => {
  const booking = await checkInService.markNoShow({
    hostId: req.user.userId,
    bookingId: req.params.bookingId,
    reason: req.body.reason,
    hostContext: { isOwner: true, allowedBranchIds: null },
  });
  res.json({ booking, message: "Đã đánh dấu no-show." });
});

// —— Customer dashboard ——
const customerDashboard = asyncHandler(async (req, res) => {
  const data = await customerDashboardService.getCustomerDashboard(
    req.user.userId,
  );
  res.json(data);
});

// —— Alternatives / public add-ons ——
const alternativeSlots = asyncHandler(async (req, res) => {
  const alts = await availabilityService.suggestAlternativeSlots({
    spaceId: req.query.spaceId || req.body.spaceId,
    startTime: req.query.startTime || req.body.startTime,
    endTime: req.query.endTime || req.body.endTime,
    max: Number(req.query.max) || 6,
  });
  res.json({ alternatives: alts });
});

const publicAddOns = asyncHandler(async (req, res) => {
  const filter = { Status: "active" };
  if (req.query.hostId) filter.HostID = req.query.hostId;
  if (req.query.branchId) filter.BranchID = req.query.branchId;
  const items = await AddOn.find(filter).limit(50).lean();
  res.json({ addOns: items });
});

const quoteBooking = asyncHandler(async (req, res) => {
  const body = { ...req.body, ...req.query };
  const userId = req.user?.userId || null;
  const result = await bookingQuoteService.quoteBooking({
    spaceId: body.spaceId,
    startTime: body.startTime,
    endTime: body.endTime,
    addOns: body.addOns || [],
    couponCode: body.couponCode || null,
    userId,
  });
  if (result.ok === false) {
    return res.status(400).json(result);
  }
  res.json({ quote: result });
});

// —— Receipt + Timeline ——
const bookingReceipt = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.bookingId);
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");
  const uid = req.user.userId;
  const role = req.user.role;
  if (
    role !== "admin" &&
    String(booking.CustomerID) !== String(uid) &&
    String(booking.HostID) !== String(uid)
  ) {
    throw new ForbiddenError("Không có quyền xem biên lai.");
  }
  const payments = await PaymentHistory.find({ BookingID: booking._id })
    .select("Amount Status TransactionCode PaymentMethod createdAt")
    .lean();
  const html = exportService.bookingReceiptHtml(booking, payments);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

const bookingTimeline = asyncHandler(async (req, res) => {
  const timeline = await bookingTimelineService.getBookingTimeline({
    bookingId: req.params.bookingId,
    userId: req.user.userId,
    role: req.user.role,
  });
  res.json(timeline);
});

const cancelPreview = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.bookingId);
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");
  if (
    String(booking.CustomerID) !== String(req.user.userId) &&
    String(booking.HostID) !== String(req.user.userId) &&
    req.user.role !== "admin"
  ) {
    throw new ForbiddenError("Không có quyền.");
  }
  const paidAgg = await PaymentHistory.aggregate([
    { $match: { BookingID: booking._id, Status: "successful" } },
    { $group: { _id: null, sum: { $sum: "$Amount" } } },
  ]);
  const preview = cancellationPolicyService.evaluateCancellation(
    { ...booking.toObject(), _successfulPaid: paidAgg[0]?.sum || 0 },
    { now: new Date() },
  );
  res.json({
    booking: presentBooking(booking, { role: req.user.role }),
    cancelPreview: preview,
  });
});

// —— Host inbox + onboarding ——
const hostInbox = asyncHandler(async (req, res) => {
  const data = await hostInboxService.listHostInbox(
    req.user.userId,
    {
      bucket: req.query.bucket,
      page: req.query.page,
      limit: req.query.limit,
    },
  );
  res.json({
    ...data,
    items: data.items.map((b) => ({
      ...presentBooking(b, { role: "host" }),
      customer: b.CustomerID,
      space: b.SpaceID,
    })),
  });
});

const hostOnboarding = asyncHandler(async (req, res) => {
  const data = await onboardingService.getHostOnboarding(
    req.user.userId,
  );
  res.json(data);
});

// —— Host internal notes ——
const addHostNote = asyncHandler(async (req, res) => {
  const body = String(req.body.body || req.body.note || "")
    .trim()
    .slice(0, 2000);
  if (!body) throw new ValidationError("Ghi chú trống.");
  const booking = await Booking.findOneAndUpdate(
    {
      _id: req.params.bookingId,
      HostID: req.user.userId,
    },
    {
      $push: {
        HostInternalNotes: {
          $each: [
            {
              Body: body,
              AuthorID: req.user.userId,
              CreatedAt: new Date(),
            },
          ],
          $slice: -50,
        },
      },
    },
    { new: true, runValidators: true },
  );
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");
  res.status(201).json({ notes: booking.HostInternalNotes || [] });
});

const listHostNotes = asyncHandler(async (req, res) => {
  const booking = await Booking.findOne({
    _id: req.params.bookingId,
    HostID: req.user.userId,
  })
    .select("HostInternalNotes")
    .lean();
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");
  res.json({ notes: booking.HostInternalNotes || [] });
});

// —— Host space ops ——
const patchSpaceOps = asyncHandler(async (req, res) => {
  const updates = {};
  if (req.body.bufferBeforeMinutes != null) {
    updates.BufferBeforeMinutes = Math.max(
      0,
      Math.min(180, Number(req.body.bufferBeforeMinutes) || 0),
    );
  }
  if (req.body.cleanupAfterMinutes != null) {
    updates.CleanupAfterMinutes = Math.max(
      0,
      Math.min(180, Number(req.body.cleanupAfterMinutes) || 0),
    );
  }
  if (typeof req.body.instantBook === "boolean") {
    updates.InstantBook = req.body.instantBook;
  }
  if (req.body.freeCancelHours != null) {
    const parsed = Number(req.body.freeCancelHours);
    if (!Number.isFinite(parsed)) {
      throw new ValidationError("freeCancelHours không hợp lệ.");
    }
    updates.FreeCancelHours = Math.max(0, Math.min(168, parsed));
  }
  const space = await Space.findOneAndUpdate(
    { _id: req.params.spaceId, HostID: req.user.userId },
    { $set: updates },
    { new: true },
  );
  if (!space) throw new NotFoundError("Không tìm thấy space.");
  res.json({ space });
});

// —— Staff actions ——
const staffHostInbox = asyncHandler(async (req, res) => {
  const hostOwnerId =
    req.hostOwnerId || req.hostContext?.hostOwnerId || req.user.userId;
  const spaceFilter = await staffService.branchScopedSpaceFilter(
    req.hostContext || {
      hostOwnerId,
      isOwner: req.user.role === "host",
      allowedBranchIds: null,
    },
  );
  const data = await hostInboxService.listHostInbox(
    hostOwnerId,
    {
      bucket: req.query.bucket,
      page: req.query.page,
      limit: req.query.limit,
      spaceFilter,
    },
  );
  res.json(data);
});

const staffReceptionToday = asyncHandler(async (req, res) => {
  const hostOwnerId = req.hostOwnerId || req.user.userId;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const spaceFilter = await staffService.branchScopedSpaceFilter(req.hostContext);
  const filter = {
    HostID: hostOwnerId,
    Status: { $in: ["confirmed", "in-use", "pending", "payment_under_review"] },
    StartTime: { $lte: end },
    EndTime: { $gte: start },
    ...(spaceFilter || {}),
  };
  const bookings = await Booking.find(filter)
    .populate("CustomerID", "FullName Email")
    .populate("SpaceID", "Name SpaceCode BranchID")
    .sort({ StartTime: 1 })
    .lean();
  res.json({
    bookings,
    hostOwnerId,
    allowedBranchIds: req.hostContext?.allowedBranchIds || null,
  });
});

const staffScanCheckIn = asyncHandler(async (req, res) => {
  const hostOwnerId = req.hostOwnerId || req.user.userId;
  const booking = await checkInService.checkInWithToken({
    hostId: hostOwnerId,
    token: req.body.token,
    code: req.body.code,
    hostContext: req.hostContext,
  });
  res.json({ booking, message: "Check-in thành công.", hostOwnerId });
});

const staffHostCalendar = asyncHandler(async (req, res) => {
  const hostOwnerId = req.hostOwnerId || req.user.userId;
  if (req.query.branchId) {
    staffService.assertBranchAccess(req.hostContext, req.query.branchId);
  } else if (
    req.hostContext &&
    !req.hostContext.isOwner &&
    req.hostContext.allowedBranchIds
  ) {
    req.query.branchId = req.hostContext.allowedBranchIds[0];
  }
  const data = await calendarService.getHostCalendar({
    hostId: hostOwnerId,
    from: req.query.from,
    to: req.query.to,
    branchId: req.query.branchId || null,
    spaceId: req.query.spaceId || null,
  });
  res.json({
    ...data,
    hostOwnerId,
    allowedBranchIds: req.hostContext?.allowedBranchIds || null,
  });
});

const staffConfirmBooking = asyncHandler(async (req, res) => {
  const hostOwnerId = req.hostOwnerId || req.user.userId;
  const bookingDoc = await Booking.findOne({
    _id: req.params.bookingId,
    HostID: hostOwnerId,
  }).select("SpaceID");
  if (!bookingDoc) {
    throw new NotFoundError("Booking not found");
  }
  if (
    req.hostContext &&
    !req.hostContext.isOwner &&
    req.hostContext.allowedBranchIds
  ) {
    const space = await Space.findById(bookingDoc.SpaceID)
      .select("BranchID")
      .lean();
    staffService.assertBranchAccess(req.hostContext, space?.BranchID);
  }
  const booking = await bookingService.confirmBooking(
    hostOwnerId,
    req.params.bookingId,
  );
  res.json({ booking, message: "Đã xác nhận booking.", hostOwnerId });
});

const staffNoShow = asyncHandler(async (req, res) => {
  const hostOwnerId = req.hostOwnerId || req.user.userId;
  const booking = await checkInService.markNoShow({
    hostId: hostOwnerId,
    bookingId: req.params.bookingId,
    reason: req.body.reason,
    hostContext: req.hostContext,
  });
  res.json({ booking, message: "Đã đánh dấu no-show.", hostOwnerId });
});

module.exports = {
  reschedulePreview,
  reschedule,
  createIncident,
  receptionToday,
  checkout,
  bulkSpaceStatus,
  bulkSpaces,
  listBlackouts,
  createBlackout,
  deleteBlackout,
  listAddOns,
  createAddOn,
  previewRecurring,
  createRecurring,
  listRecurring,
  cancelRecurring,
  createGroupBooking,
  listGroupInvites,
  getGroupInvitePublic,
  rsvpGroupInvite,
  mintCheckIn,
  scanCheckIn,
  markNoShow,
  customerDashboard,
  alternativeSlots,
  publicAddOns,
  quoteBooking,
  bookingReceipt,
  bookingTimeline,
  cancelPreview,
  hostInbox,
  hostOnboarding,
  listHostNotes,
  addHostNote,
  patchSpaceOps,
  staffHostInbox,
  staffReceptionToday,
  staffScanCheckIn,
  staffHostCalendar,
  staffConfirmBooking,
  staffNoShow,
};
