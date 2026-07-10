'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, paginationMeta } = require('../utils/pagination');
const searchService = require('../services/searchService');
const rescheduleService = require('../services/rescheduleService');
const refundService = require('../services/refundService');
const disputeService = require('../services/disputeService');
const staffService = require('../services/staffService');
const ledgerService = require('../services/ledgerService');
const pricingService = require('../services/pricingService');
const cmsService = require('../services/cmsService');
const schemas = require('../validators/schemas');
const AddOn = require('../models/AddOn');
const Blackout = require('../models/Blackout');
const PricingRule = require('../models/PricingRule');
const SupportTicket = require('../models/SupportTicket');
const Incident = require('../models/Incident');
const FeatureFlag = require('../models/FeatureFlag');
const Space = require('../models/Space');
const bookingService = require('../services/bookingService');
const paymentService = require('../services/paymentService');
const { MembershipPlan, Membership } = require('../models/Membership');

// —— Search ——
const search = asyncHandler(async (req, res) => {
  const data = await searchService.searchBranches(req.query);
  res.json(data);
});

const autocomplete = asyncHandler(async (req, res) => {
  const data = await searchService.autocomplete(req.query.q || '');
  res.json(data);
});

// —— Reschedule ——
const reschedule = asyncHandler(async (req, res) => {
  const body = schemas.parse(schemas.reschedule, req.body);
  const booking = await rescheduleService.rescheduleBooking({
    bookingId: req.params.bookingId,
    userId: req.user.userId,
    role: req.user.role,
    startTime: body.startTime,
    endTime: body.endTime,
  });
  res.json({ message: 'Đã đổi lịch.', booking });
});

// —— Refunds ——
const requestRefund = asyncHandler(async (req, res) => {
  const body = schemas.parse(schemas.refundRequest, req.body);
  const key = req.get('Idempotency-Key');
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
  res.json({ disputes: data.items, pagination: paginationMeta(data.total, page, limit) });
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
  if (!space) return res.status(404).json({ error: 'Space not found' });
  const q = await pricingService.quotePrice({
    hostId: space.HostID,
    spaceId: space._id,
    branchId: space.BranchID,
    start: startTime,
    end: endTime,
    basePricePerHour: space.PricePerHour,
  });
  res.json(q);
});

// —— Add-ons / blackouts / pricing rules (host) ——
const listAddOns = asyncHandler(async (req, res) => {
  const items = await AddOn.find({ HostID: req.user.userId }).sort({ createdAt: -1 }).lean();
  res.json({ addOns: items });
});

const createAddOn = asyncHandler(async (req, res) => {
  const doc = await AddOn.create({
    HostID: req.user.userId,
    BranchID: req.body.branchId || null,
    Name: req.body.name,
    Description: req.body.description || '',
    Price: Number(req.body.price) || 0,
    Unit: req.body.unit || 'booking',
    Inventory: req.body.inventory ?? null,
    Refundable: req.body.refundable !== false,
  });
  res.status(201).json({ addOn: doc });
});

const createBlackout = asyncHandler(async (req, res) => {
  const doc = await Blackout.create({
    HostID: req.user.userId,
    SpaceID: req.body.spaceId,
    StartTime: new Date(req.body.startTime),
    EndTime: new Date(req.body.endTime),
    Reason: req.body.reason || 'maintenance',
  });
  res.status(201).json({ blackout: doc });
});

const listBlackouts = asyncHandler(async (req, res) => {
  const items = await Blackout.find({ HostID: req.user.userId }).sort({ StartTime: -1 }).limit(100).lean();
  res.json({ blackouts: items });
});

const createPricingRule = asyncHandler(async (req, res) => {
  const doc = await PricingRule.create({
    HostID: req.user.userId,
    BranchID: req.body.branchId || null,
    SpaceID: req.body.spaceId || null,
    Name: req.body.name,
    Type: req.body.type,
    Multiplier: Number(req.body.multiplier) || 1,
    FixedAdjust: Number(req.body.fixedAdjust) || 0,
    Priority: Number(req.body.priority) || 100,
    DayOfWeek: req.body.dayOfWeek || [],
    HourStart: req.body.hourStart ?? null,
    HourEnd: req.body.hourEnd ?? null,
    MinHours: req.body.minHours ?? null,
    Status: 'active',
  });
  res.status(201).json({ rule: doc });
});

// —— Support ——
const createTicket = asyncHandler(async (req, res) => {
  const body = schemas.parse(schemas.supportTicket, req.body);
  const t = await SupportTicket.create({
    UserID: req.user.userId,
    BookingID: body.bookingId || null,
    Subject: body.subject,
    Body: body.body,
  });
  res.status(201).json({ ticket: t });
});

const listTickets = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { UserID: req.user.userId };
  const items = await SupportTicket.find(filter).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ tickets: items });
});

// —— Incidents ——
const createIncident = asyncHandler(async (req, res) => {
  const doc = await Incident.create({
    BookingID: req.body.bookingId,
    HostID: req.user.userId,
    ReportedBy: req.user.userId,
    Type: req.body.type || 'other',
    Description: req.body.description,
    InternalNote: req.body.internalNote || '',
    CustomerNote: req.body.customerNote || '',
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
  const plans = await MembershipPlan.find({ Status: 'active' }).lean();
  res.json({ plans });
});

const myMembership = asyncHandler(async (req, res) => {
  const m = await Membership.findOne({ UserID: req.user.userId, Status: 'active' })
    .populate('PlanID')
    .lean();
  res.json({ membership: m });
});

// —— Feature flags ——
const flags = asyncHandler(async (req, res) => {
  const featureFlagService = require('../services/featureFlagService');
  const map = await featureFlagService.listPublicFlags({
    userId: req.user?.userId || null,
    role: req.user?.role || null,
  });
  res.json({ flags: map });
});

const adminListFlags = asyncHandler(async (req, res) => {
  const featureFlagService = require('../services/featureFlagService');
  res.json({ flags: await featureFlagService.listAllFlags() });
});

const adminUpsertFlag = asyncHandler(async (req, res) => {
  const featureFlagService = require('../services/featureFlagService');
  const flag = await featureFlagService.upsertFlag({
    key: req.body.key,
    enabled: req.body.enabled,
    description: req.body.description || '',
    percentage: req.body.percentage,
    roles: req.body.roles || [],
    environments: req.body.environments || [],
  });
  res.json({ flag });
});

// —— Bulk space status ——
const bulkSpaceStatus = asyncHandler(async (req, res) => {
  const ids = req.body.spaceIds || [];
  const status = req.body.status;
  if (!['available', 'maintenance', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'Status không hợp lệ' });
  }
  const r = await Space.updateMany(
    { _id: { $in: ids }, HostID: req.user.userId },
    { $set: { Status: status } }
  );
  res.json({ modified: r.modifiedCount });
});

// —— Reception today ——
const receptionToday = asyncHandler(async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const Booking = require('../models/Booking');
  const bookings = await Booking.find({
    HostID: req.user.userId,
    Status: { $in: ['confirmed', 'in-use', 'pending', 'payment_under_review'] },
    StartTime: { $lte: end },
    EndTime: { $gte: start },
  })
    .populate('CustomerID', 'FullName Email')
    .populate('SpaceID', 'Name SpaceCode')
    .sort({ StartTime: 1 })
    .lean();
  res.json({ bookings });
});

// —— Checkout ——
const checkout = asyncHandler(async (req, res) => {
  const Booking = require('../models/Booking');
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.bookingId, HostID: req.user.userId, Status: 'in-use' },
    { $set: { Status: 'completed', CheckOutAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!booking) return res.status(404).json({ error: 'Không check-out được.' });
  res.json({ booking });
});

// Wire ledger on payment verify (export helper used by host routes override if needed)
const verifyPaymentWithLedger = asyncHandler(async (req, res) => {
  const payment = await paymentService.verifyPayment(req.user.userId, req.params.paymentId);
  await ledgerService.postEntry({
    hostId: req.user.userId,
    customerId: payment.CustomerID,
    bookingId: payment.BookingID,
    paymentId: payment._id,
    type: 'payment',
    amount: payment.Amount,
    direction: 'credit',
    description: `Payment ${payment.TransactionCode}`,
    idempotencyKey: `ledger-pay-${payment._id}`,
  });
  res.json({ message: 'Đã xác minh thanh toán.', payment });
});

module.exports = {
  search,
  autocomplete,
  reschedule,
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
  listAddOns,
  createAddOn,
  createBlackout,
  listBlackouts,
  createPricingRule,
  createTicket,
  listTickets,
  createIncident,
  listCms,
  getCms,
  upsertCms,
  listPlans,
  myMembership,
  flags,
  adminListFlags,
  adminUpsertFlag,
  bulkSpaceStatus,
  receptionToday,
  checkout,
  verifyPaymentWithLedger,
};
