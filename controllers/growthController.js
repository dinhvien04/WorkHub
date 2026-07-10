'use strict';

const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const gatewayService = require('../services/gatewayService');
const payoutService = require('../services/payoutService');
const membershipService = require('../services/membershipService');
const recurringService = require('../services/recurringService');
const fraudService = require('../services/fraudService');
const jobQueue = require('../services/jobQueue');
const { detectLang } = require('../services/i18n');
const ApiKey = require('../models/ApiKey');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Space = require('../models/Space');
const UserSession = require('../models/Session');
const calendarService = require('../services/calendarService');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/errors');

// —— Gateway ——
const createCheckout = asyncHandler(async (req, res) => {
  const result = await gatewayService.createCheckoutSession({
    customerId: req.user.userId,
    bookingId: req.body.bookingId,
    // amount/provider from client are ignored server-side
    paymentType: req.body.paymentType || 'deposit',
    idempotencyKey: req.get('Idempotency-Key') || req.body.idempotencyKey,
  });
  res.status(201).json(result);
});

const gatewayWebhook = asyncHandler(async (req, res) => {
  // Prefer exact raw body (Buffer) from express.raw mount
  let raw;
  if (Buffer.isBuffer(req.body)) {
    raw = req.body.toString('utf8');
  } else if (typeof req.body === 'string') {
    raw = req.body;
  } else if (req.rawBody) {
    raw = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.rawBody);
  } else {
    raw = JSON.stringify(req.body || {});
  }
  const signature =
    req.get('x-workhub-signature') ||
    req.get('x-webhook-signature') ||
    req.get('stripe-signature') ||
    req.get('x-momo-signature');
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
    provider: req.query.provider || req.get('x-payment-provider'),
  });
  res.json(result);
});

const listGatewayProviders = asyncHandler(async (req, res) => {
  res.json({ providers: await gatewayService.listProviders() });
});

const mockCompleteGateway = asyncHandler(async (req, res) => {
  const result = await gatewayService.mockCompleteSession(
    req.params.sessionId,
    req.user.userId
  );
  res.json(result);
});

const getGatewaySession = asyncHandler(async (req, res) => {
  // Owner-only — SessionId is not an authorization secret
  const dto = await gatewayService.getSessionForCustomer(
    req.params.sessionId,
    req.user.userId
  );
  res.json(dto);
});

// —— Payout ——
const requestPayout = asyncHandler(async (req, res) => {
  const payout = await payoutService.requestPayout({
    hostId: req.user.userId,
    amount: req.body.amount,
    idempotencyKey: req.get('Idempotency-Key'),
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
  });
  res.json({ payout });
});

// —— Membership ——
const listPlans = asyncHandler(async (req, res) => {
  res.json({ plans: await membershipService.listPlans() });
});

const myMembership = asyncHandler(async (req, res) => {
  res.json({ membership: await membershipService.getActiveMembership(req.user.userId) });
});

const subscribe = asyncHandler(async (req, res) => {
  const m = await membershipService.subscribe({
    userId: req.user.userId,
    planCode: req.body.planCode,
  });
  res.status(201).json({ membership: m });
});

const myCreditLedger = asyncHandler(async (req, res) => {
  const { parsePagination, paginationMeta } = require('../utils/pagination');
  const { page, limit } = parsePagination(req.query);
  const data = await membershipService.listCreditLedger(req.user.userId, { page, limit });
  res.json({ ...data, pagination: paginationMeta(data.total, page, limit) });
});

// —— Recurring ——
const previewRecurring = asyncHandler(async (req, res) => {
  const body = { ...req.body, ...req.query };
  const preview = await recurringService.previewSeries({
    spaceId: body.spaceId,
    frequency: body.frequency,
    interval: body.interval,
    daysOfWeek: body.daysOfWeek
      ? Array.isArray(body.daysOfWeek)
        ? body.daysOfWeek
        : String(body.daysOfWeek).split(',').map(Number)
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
  if (!space) throw new NotFoundError('Space not found');
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
  });
  res.status(201).json(result);
});

const listRecurring = asyncHandler(async (req, res) => {
  const items = await recurringService.listSeries(req.user.userId);
  res.json({ series: items });
});

const cancelRecurring = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await recurringService.cancelSeries(req.params.seriesId, req.user.userId, {
    mode: body.mode || req.query.mode || 'whole',
    occurrenceBookingId: body.occurrenceBookingId || req.query.occurrenceBookingId || null,
  });
  res.json({ ...result, message: 'Đã hủy series/occurrence.' });
});

// —— Fraud score (preview) ——
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

// —— Partner API keys (verified host only) ——
const createApiKey = asyncHandler(async (req, res) => {
  if (req.user.role !== 'host' && req.user.role !== 'admin') {
    throw new ForbiddenError('Chỉ host đã xác minh hoặc admin mới tạo API key.');
  }
  const hostOwnerId = req.user.role === 'admin' && req.body.hostOwnerId
    ? req.body.hostOwnerId
    : req.user.userId;

  if (req.user.role === 'host') {
    const HostProfile = require('../models/Host_Profile');
    const profile = await HostProfile.findOne({ UserID: req.user.userId }).lean();
    if (!profile?.IsVerified) {
      throw new ForbiddenError('Host chưa được xác minh.');
    }
  }

  const requested = Array.isArray(req.body.scopes) ? req.body.scopes : ['bookings:read', 'spaces:read'];
  const allow = req.user.role === 'admin' ? ApiKey.ADMIN_SCOPES : ApiKey.HOST_SCOPES;
  let scopes = requested.filter((s) => allow.includes(s));
  if (scopes.includes('*') && req.user.role !== 'admin') {
    throw new ForbiddenError('Wildcard scope chỉ dành cho admin.');
  }
  if (!scopes.length) scopes = ['bookings:read'];

  let branchIds = Array.isArray(req.body.allowedBranchIds) ? req.body.allowedBranchIds : [];
  if (branchIds.length) {
    const Branch = require('../models/Branch');
    const owned = await Branch.find({
      _id: { $in: branchIds },
      HostID: hostOwnerId,
    }).select('_id');
    branchIds = owned.map((b) => b._id);
  }

  const { raw, prefix, hash } = ApiKey.generate();
  const expiresAt = req.body.expiresAt
    ? new Date(req.body.expiresAt)
    : new Date(Date.now() + 365 * 24 * 3600000);

  const doc = await ApiKey.create({
    Name: String(req.body.name || 'Partner key').slice(0, 100),
    OwnerUserID: req.user.userId,
    HostOwnerID: hostOwnerId,
    AllowedBranchIDs: branchIds,
    KeyPrefix: prefix,
    KeyHash: hash,
    Scopes: scopes,
    Status: 'active',
    ExpiresAt: expiresAt,
    CreatedBy: req.user.userId,
  });
  res.status(201).json({
    apiKey: {
      id: doc._id,
      prefix,
      scopes: doc.Scopes,
      name: doc.Name,
      hostOwnerId: doc.HostOwnerID,
      allowedBranchIds: doc.AllowedBranchIDs,
      expiresAt: doc.ExpiresAt,
    },
    secret: raw,
    warning: 'Store secret securely; it will not be shown again.',
  });
});

const listApiKeys = asyncHandler(async (req, res) => {
  const items = await ApiKey.find({ OwnerUserID: req.user.userId })
    .select('-KeyHash')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ keys: items });
});

const revokeApiKey = asyncHandler(async (req, res) => {
  const doc = await ApiKey.findOneAndUpdate(
    { _id: req.params.id, OwnerUserID: req.user.userId },
    { $set: { Status: 'revoked' } },
    { new: true }
  ).select('-KeyHash');
  if (!doc) throw new NotFoundError('API key not found');
  res.json({ key: doc });
});

// Partner public API (API key auth) — tenant-scoped
const partnerListSpaces = asyncHandler(async (req, res) => {
  const filter = {
    Status: 'available',
    HostID: req.apiKey.HostOwnerID || req.apiKey.OwnerUserID,
  };
  if (req.apiKey.AllowedBranchIDs?.length) {
    filter.BranchID = { $in: req.apiKey.AllowedBranchIDs };
  }
  const spaces = await Space.find(filter)
    .select('Name SpaceCode Category PricePerHour Capacity BranchID Status')
    .limit(50)
    .lean();
  res.json({ spaces });
});

const partnerGetBooking = asyncHandler(async (req, res) => {
  const hostId = req.apiKey.HostOwnerID || req.apiKey.OwnerUserID;
  const filter = {
    _id: req.params.id,
    HostID: hostId,
  };
  const booking = await Booking.findOne(filter)
    .select('Status StartTime EndTime TotalAmount SpaceID HostID BranchID Snapshot.SpaceCode Snapshot.SpaceName')
    .lean();
  if (!booking) throw new NotFoundError('Booking not found');

  // Branch scope when key is limited
  if (req.apiKey.AllowedBranchIDs?.length) {
    const Space = require('../models/Space');
    const space = await Space.findById(booking.SpaceID).select('BranchID').lean();
    const branchId = booking.BranchID || space?.BranchID;
    const allowed = req.apiKey.AllowedBranchIDs.map(String);
    if (!branchId || !allowed.includes(String(branchId))) {
      throw new NotFoundError('Booking not found');
    }
  }

  // Safe DTO — no CustomerID, no unrestricted Snapshot
  res.json({
    booking: {
      id: booking._id,
      status: booking.Status,
      startTime: booking.StartTime,
      endTime: booking.EndTime,
      totalAmount: booking.TotalAmount,
      spaceId: booking.SpaceID,
      spaceCode: booking.Snapshot?.SpaceCode,
      spaceName: booking.Snapshot?.SpaceName,
    },
  });
});

// —— Sessions ——
const listSessions = asyncHandler(async (req, res) => {
  const items = await UserSession.find({
    UserID: req.user.userId,
    RevokedAt: null,
  })
    .sort({ LastSeenAt: -1 })
    .limit(20)
    .lean();
  res.json({ sessions: items });
});

const logoutAll = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId);
  if (!user) throw new NotFoundError('User not found');
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await UserSession.updateMany(
    { UserID: user._id, RevokedAt: null },
    { $set: { RevokedAt: new Date() } }
  );
  res.clearCookie(require('../config/env').AUTH_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });
  res.json({ message: 'Đã đăng xuất tất cả thiết bị.' });
});

// —— i18n ——
const i18nBundle = asyncHandler(async (req, res) => {
  const lang = detectLang(req);
  res.json({ lang, messages: require('../services/i18n').dictionaries[lang] || require('../services/i18n').dictionaries.vi });
});

const setLang = asyncHandler(async (req, res) => {
  const { setLangCookie } = require('../services/i18n');
  const lang = setLangCookie(res, req.body.lang || req.query.lang || 'vi');
  // Persist on user when authenticated
  if (req.user?.userId) {
    try {
      await User.findByIdAndUpdate(req.user.userId, { $set: { PreferredLang: lang } });
    } catch {
      /* ignore */
    }
  }
  res.json({ lang, messages: require('../services/i18n').dictionaries[lang] });
});

// —— Host external calendar feed (token-less signed by host id hash for demo) ——
const hostIcalFeed = asyncHandler(async (req, res) => {
  const hostId = req.params.hostId;
  const token = req.query.token;
  const expected = crypto.createHash('sha256').update(`${hostId}:${require('../config/env').JWT_SECRET}`).digest('hex').slice(0, 16);
  if (token !== expected) {
    return res.status(401).send('Invalid feed token');
  }
  const from = new Date();
  const to = new Date(Date.now() + 30 * 86400000);
  const data = await calendarService.getHostCalendar({ hostId, from, to });
  const blocks = (data.events || []).map((ev) => {
    const fake = {
      _id: ev.id,
      StartTime: ev.start,
      EndTime: ev.end,
      Snapshot: { SpaceName: ev.title, Address: '' },
    };
    return calendarService.bookingToIcs(fake).replace(/BEGIN:VCALENDAR[\s\S]*?BEGIN:VEVENT/, 'BEGIN:VEVENT').replace(/END:VCALENDAR\s*$/, '');
  });
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorkHub//EN', ...blocks, 'END:VCALENDAR', ''].join('\r\n');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.send(ics);
});

// —— Dead letters admin ——
const listDeadLetters = asyncHandler(async (req, res) => {
  const items = await jobQueue.listDeadLetters({ limit: 50 });
  res.json({ items });
});

const discardDeadLetter = asyncHandler(async (req, res) => {
  const doc = await jobQueue.discardDeadLetter(req.params.id);
  if (!doc) throw new NotFoundError('Dead letter not found');
  res.json({ item: doc });
});

const replayDeadLetter = asyncHandler(async (req, res) => {
  const result = await jobQueue.replayDeadLetter(req.params.id);
  res.json(result);
});

const retryJob = asyncHandler(async (req, res) => {
  const job = await jobQueue.retryFailedJob(req.params.jobId);
  res.json({ job });
});

const downloadJobFile = asyncHandler(async (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const job = await jobQueue.getJob(req.params.jobId);
  if (!job) throw new NotFoundError('Job not found');
  if (
    req.user.role !== 'admin' &&
    job.OwnerUserID &&
    String(job.OwnerUserID) !== String(req.user.userId)
  ) {
    throw new ForbiddenError('Không có quyền tải file job.');
  }
  if (job.Status !== 'completed' || !job.Result?.file) {
    throw new ValidationError('Job chưa có file kết quả.');
  }
  const rel = String(job.Result.file).replace(/\\/g, '/');
  if (rel.includes('..') || !rel.startsWith('tmp/exports/')) {
    throw new ForbiddenError('Đường dẫn file không hợp lệ.');
  }
  const abs = path.join(process.cwd(), rel);
  if (!fs.existsSync(abs)) throw new NotFoundError('File không còn trên đĩa.');
  res.download(abs, path.basename(abs));
});

// —— Corporate / group booking + RSVP ——
const createGroupBooking = asyncHandler(async (req, res) => {
  const groupBookingService = require('../services/groupBookingService');
  const result = await groupBookingService.createGroupBooking({
    customerId: req.user.userId,
    spaceId: req.body.spaceId,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    note: req.body.note || '',
    corporateName: req.body.corporateName || '',
    attendees: req.body.attendees || [],
    addOns: req.body.addOns || [],
    couponCode: req.body.couponCode || null,
  });
  res.status(201).json(result);
});

const listGroupInvites = asyncHandler(async (req, res) => {
  const groupBookingService = require('../services/groupBookingService');
  const invites = await groupBookingService.listInvitesForBooking({
    bookingId: req.params.bookingId,
    userId: req.user.userId,
  });
  res.json({ invites });
});

const getGroupInvitePublic = asyncHandler(async (req, res) => {
  const groupBookingService = require('../services/groupBookingService');
  const data = await groupBookingService.getInviteByToken(req.params.token);
  res.json(data);
});

const rsvpGroupInvite = asyncHandler(async (req, res) => {
  const groupBookingService = require('../services/groupBookingService');
  const invite = await groupBookingService.rsvpByToken({
    token: req.params.token,
    status: req.body.status,
    note: req.body.note,
  });
  res.json({ invite, message: 'Đã ghi nhận RSVP.' });
});

// —— RUM / Web Vitals beacon (no PII; fire-and-forget) ——
const rumBeacon = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const metrics = {
    lcp: Number(body.lcp) || null,
    inp: Number(body.inp) || null,
    cls: Number(body.cls) || null,
    ttfb: Number(body.ttfb) || null,
    fcp: Number(body.fcp) || null,
    path: String(body.path || '').slice(0, 200),
    navType: String(body.navType || '').slice(0, 40),
  };
  // Log only — no storage of user identifiers
  try {
    require('../utils/logger').info({ rum: metrics }, 'web-vitals');
  } catch {
    /* ignore */
  }
  res.status(204).end();
});

// —— Reporting advanced ——
const hostAdvancedReport = asyncHandler(async (req, res) => {
  const paymentService = require('../services/paymentService');
  const metrics = await paymentService.getHostRevenueMetrics(req.user.userId);
  const balance = await require('../services/ledgerService').getHostBalance(req.user.userId);
  const payouts = await payoutService.listHostPayouts(req.user.userId);
  res.json({
    revenue: metrics,
    balance,
    payoutsSummary: {
      count: payouts.length,
      paid: payouts.filter((p) => p.Status === 'paid').reduce((s, p) => s + p.Amount, 0),
    },
  });
});

// —— QR check-in / no-show ——
const mintCheckIn = asyncHandler(async (req, res) => {
  const checkInService = require('../services/checkInService');
  const result = await checkInService.mintCheckInToken({
    bookingId: req.params.bookingId,
    actorId: req.user.userId,
    actorRole: req.user.role,
  });
  res.json(result);
});

const scanCheckIn = asyncHandler(async (req, res) => {
  const checkInService = require('../services/checkInService');
  const booking = await checkInService.checkInWithToken({
    hostId: req.user.userId,
    token: req.body.token,
    code: req.body.code,
    hostContext: { isOwner: true, allowedBranchIds: null },
  });
  res.json({ booking, message: 'Check-in thành công.' });
});

const markNoShow = asyncHandler(async (req, res) => {
  const checkInService = require('../services/checkInService');
  const booking = await checkInService.markNoShow({
    hostId: req.user.userId,
    bookingId: req.params.bookingId,
    reason: req.body.reason,
    hostContext: { isOwner: true, allowedBranchIds: null },
  });
  res.json({ booking, message: 'Đã đánh dấu no-show.' });
});

// —— Notification preferences ——
const getNotifyPrefs = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId)
    .select('NotifyEmail NotifyPush NotifySms MarketingOptIn PreferredLang Timezone')
    .lean();
  res.json({
    prefs: {
      email: user?.NotifyEmail !== false,
      push: user?.NotifyPush !== false,
      sms: !!user?.NotifySms,
      marketing: !!user?.MarketingOptIn,
      lang: user?.PreferredLang || 'vi',
      timezone: user?.Timezone || 'Asia/Ho_Chi_Minh',
    },
  });
});

const updateNotifyPrefs = asyncHandler(async (req, res) => {
  const updates = {};
  if (typeof req.body.email === 'boolean') updates.NotifyEmail = req.body.email;
  if (typeof req.body.push === 'boolean') updates.NotifyPush = req.body.push;
  if (typeof req.body.sms === 'boolean') updates.NotifySms = req.body.sms;
  if (typeof req.body.marketing === 'boolean') updates.MarketingOptIn = req.body.marketing;
  if (req.body.lang) updates.PreferredLang = String(req.body.lang).slice(0, 8);
  if (req.body.timezone) updates.Timezone = String(req.body.timezone).slice(0, 64);
  const user = await User.findByIdAndUpdate(req.user.userId, { $set: updates }, { new: true })
    .select('NotifyEmail NotifyPush NotifySms MarketingOptIn PreferredLang Timezone')
    .lean();
  res.json({ prefs: user });
});

// —— System health (admin) ——
const systemHealth = asyncHandler(async (req, res) => {
  const mongoose = require('mongoose');
  const pkg = require('../package.json');
  const mem = process.memoryUsage();
  let redis = { configured: Boolean(process.env.REDIS_URL), ok: false, mode: 'none' };
  if (process.env.REDIS_URL) {
    try {
      const { getRateLimitStore } = require('../utils/rateLimitStore');
      await getRateLimitStore(1000);
      redis = { configured: true, ok: true, mode: 'redis_or_memory_fallback' };
    } catch (e) {
      redis = { configured: true, ok: false, error: e.message };
    }
  } else {
    redis = { configured: false, ok: true, mode: 'memory' };
  }
  res.json({
    status: mongoose.connection.readyState === 1 ? 'ok' : 'degraded',
    version: pkg.version,
    node: process.version,
    uptimeSec: Math.round(process.uptime()),
    db: { readyState: mongoose.connection.readyState },
    redis,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
    },
    env: process.env.NODE_ENV || 'development',
    useTailwindCdn: process.env.USE_TAILWIND_CDN,
    paymentProvider: process.env.PAYMENT_PROVIDER || 'workhub_mock',
    timestamp: new Date().toISOString(),
  });
});

// —— Customer dashboard ——
const customerDashboard = asyncHandler(async (req, res) => {
  const data = await require('../services/customerDashboardService').getCustomerDashboard(
    req.user.userId
  );
  res.json(data);
});

// —— SEO redirect admin ——
const upsertSeoRedirect = asyncHandler(async (req, res) => {
  const SeoRedirect = require('../models/SeoRedirect');
  const from = String(req.body.fromPath || '').trim();
  const to = String(req.body.toPath || '').trim();
  if (!from || !to) throw new ValidationError('fromPath và toPath bắt buộc.');
  const doc = await SeoRedirect.findOneAndUpdate(
    { FromPath: from },
    {
      $set: {
        ToPath: to,
        StatusCode: req.body.statusCode === 302 ? 302 : 301,
        Active: req.body.active !== false,
        Note: req.body.note || '',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ redirect: doc });
});

const listSeoRedirects = asyncHandler(async (req, res) => {
  const SeoRedirect = require('../models/SeoRedirect');
  res.json({ redirects: await SeoRedirect.find().sort({ FromPath: 1 }).lean() });
});

const deleteSeoRedirect = asyncHandler(async (req, res) => {
  const SeoRedirect = require('../models/SeoRedirect');
  const id = req.params.id;
  const fromPath = req.query?.fromPath || (req.body && req.body.fromPath);
  let doc;
  if (id && String(id).match(/^[a-f\d]{24}$/i)) {
    doc = await SeoRedirect.findByIdAndDelete(id);
  } else if (fromPath) {
    doc = await SeoRedirect.findOneAndDelete({ FromPath: String(fromPath).trim() });
  } else {
    throw new ValidationError('Thiếu id hoặc fromPath.');
  }
  if (!doc) throw new NotFoundError('Không tìm thấy redirect.');
  res.json({ deleted: true, redirect: doc });
});

const toggleSeoRedirect = asyncHandler(async (req, res) => {
  const SeoRedirect = require('../models/SeoRedirect');
  const doc = await SeoRedirect.findById(req.params.id);
  if (!doc) throw new NotFoundError('Không tìm thấy redirect.');
  doc.Active = typeof req.body.active === 'boolean' ? req.body.active : !doc.Active;
  await doc.save();
  res.json({ redirect: doc });
});

// —— Alternatives / public add-ons ——
const alternativeSlots = asyncHandler(async (req, res) => {
  const availabilityService = require('../services/availabilityService');
  const alts = await availabilityService.suggestAlternativeSlots({
    spaceId: req.query.spaceId || req.body.spaceId,
    startTime: req.query.startTime || req.body.startTime,
    endTime: req.query.endTime || req.body.endTime,
    max: Number(req.query.max) || 6,
  });
  res.json({ alternatives: alts });
});

const publicAddOns = asyncHandler(async (req, res) => {
  const AddOn = require('../models/AddOn');
  const filter = { Status: 'active' };
  if (req.query.hostId) filter.HostID = req.query.hostId;
  if (req.query.branchId) filter.BranchID = req.query.branchId;
  const items = await AddOn.find(filter).limit(50).lean();
  res.json({ addOns: items });
});

/** Public/server quote — no booking created; coupon needs auth user if provided */
const quoteBooking = asyncHandler(async (req, res) => {
  const bookingQuoteService = require('../services/bookingQuoteService');
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

// —— Receipt + ledger CSV ——
const bookingReceipt = asyncHandler(async (req, res) => {
  const Booking = require('../models/Booking');
  const PaymentHistory = require('../models/Payment_History');
  const exportService = require('../services/exportService');
  const booking = await Booking.findById(req.params.bookingId);
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');
  const uid = req.user.userId;
  const role = req.user.role;
  if (
    role !== 'admin' &&
    String(booking.CustomerID) !== String(uid) &&
    String(booking.HostID) !== String(uid)
  ) {
    throw new ForbiddenError('Không có quyền xem biên lai.');
  }
  const payments = await PaymentHistory.find({ BookingID: booking._id })
    .select('Amount Status TransactionCode PaymentMethod createdAt')
    .lean();
  const html = exportService.bookingReceiptHtml(booking, payments);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

const exportLedgerCsv = asyncHandler(async (req, res) => {
  const ledgerService = require('../services/ledgerService');
  const exportService = require('../services/exportService');
  const data = await ledgerService.listLedger(req.user.userId, { page: 1, limit: 500 });
  const csv = exportService.ledgerToCsv(data.items);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="workhub-ledger.csv"');
  res.send(csv);
});

/** Large export via background job */
const enqueueLedgerExport = asyncHandler(async (req, res) => {
  const jobQueue = require('../services/jobQueue');
  const job = await jobQueue.enqueue({
    type: 'export_ledger',
    queue: 'exports',
    ownerUserId: req.user.userId,
    payload: { hostId: req.user.userId },
  });
  res.status(202).json({
    message: 'Đã xếp hàng export ledger.',
    jobId: job._id,
    status: job.Status,
  });
});

const enqueueBookingsExport = asyncHandler(async (req, res) => {
  const jobQueue = require('../services/jobQueue');
  const job = await jobQueue.enqueue({
    type: 'export_bookings',
    queue: 'exports',
    ownerUserId: req.user.userId,
    payload: { hostId: req.user.userId },
  });
  res.status(202).json({
    message: 'Đã xếp hàng export bookings.',
    jobId: job._id,
    status: job.Status,
  });
});

const getJobStatus = asyncHandler(async (req, res) => {
  const jobQueue = require('../services/jobQueue');
  const job = await jobQueue.getJob(req.params.jobId);
  if (!job) throw new NotFoundError('Job not found');
  if (
    req.user.role !== 'admin' &&
    job.OwnerUserID &&
    String(job.OwnerUserID) !== String(req.user.userId)
  ) {
    throw new ForbiddenError('Không có quyền xem job này.');
  }
  res.json({ job });
});

const listMyJobs = asyncHandler(async (req, res) => {
  const jobQueue = require('../services/jobQueue');
  const jobs = await jobQueue.listJobsForUser(req.user.userId, { limit: 30 });
  res.json({ jobs });
});

// —— Review report / moderate / host reply ——
const reportReview = asyncHandler(async (req, res) => {
  const Review = require('../models/Review');
  const review = await Review.findById(req.params.reviewId);
  if (!review) throw new NotFoundError('Không tìm thấy review.');
  const reason = String(req.body.reason || 'abuse').slice(0, 500);
  review.ReportCount = (review.ReportCount || 0) + 1;
  review.ReportReasons = [...(review.ReportReasons || []), reason].slice(-20);
  if (review.Status === 'published') review.Status = 'reported';
  await review.save();
  res.json({ review, message: 'Đã gửi báo cáo review.' });
});

const moderateReview = asyncHandler(async (req, res) => {
  const Review = require('../models/Review');
  const status = req.body.status;
  if (!['published', 'hidden', 'removed'].includes(status)) {
    throw new ValidationError('Status không hợp lệ.');
  }
  const review = await Review.findByIdAndUpdate(
    req.params.reviewId,
    {
      $set: {
        Status: status,
        ModeratedBy: req.user.userId,
        ModeratedAt: new Date(),
      },
    },
    { new: true }
  );
  if (!review) throw new NotFoundError('Không tìm thấy review.');
  res.json({ review });
});

const hostReplyReview = asyncHandler(async (req, res) => {
  const Review = require('../models/Review');
  const Space = require('../models/Space');
  const review = await Review.findById(req.params.reviewId);
  if (!review) throw new NotFoundError('Không tìm thấy review.');
  const space = await Space.findById(review.SpaceID).select('HostID');
  if (!space || String(space.HostID) !== String(req.user.userId)) {
    throw new ValidationError('Chỉ host của listing mới được trả lời.');
  }
  review.HostReply = String(req.body.reply || '').slice(0, 2000);
  review.HostRepliedAt = new Date();
  await review.save();
  res.json({ review });
});

// —— Public host profile (no secrets) ——
const publicHostProfile = asyncHandler(async (req, res) => {
  const data = await require('../services/publicHostService').getPublicHostProfile(
    req.params.hostId
  );
  res.json({ host: data });
});

// —— Booking timeline + cancel preview ——
const bookingTimeline = asyncHandler(async (req, res) => {
  const timeline = await require('../services/bookingTimelineService').getBookingTimeline({
    bookingId: req.params.bookingId,
    userId: req.user.userId,
    role: req.user.role,
  });
  res.json(timeline);
});

const cancelPreview = asyncHandler(async (req, res) => {
  const Booking = require('../models/Booking');
  const PaymentHistory = require('../models/Payment_History');
  const cancellationPolicyService = require('../services/cancellationPolicyService');
  const { presentBooking } = require('../presenters/bookingPresenter');
  const booking = await Booking.findById(req.params.bookingId);
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');
  if (
    String(booking.CustomerID) !== String(req.user.userId) &&
    String(booking.HostID) !== String(req.user.userId) &&
    req.user.role !== 'admin'
  ) {
    throw new ForbiddenError('Không có quyền.');
  }
  const paidAgg = await PaymentHistory.aggregate([
    { $match: { BookingID: booking._id, Status: 'successful' } },
    { $group: { _id: null, sum: { $sum: '$Amount' } } },
  ]);
  const preview = cancellationPolicyService.evaluateCancellation(
    { ...booking.toObject(), _successfulPaid: paidAgg[0]?.sum || 0 },
    { now: new Date() }
  );
  res.json({
    booking: presentBooking(booking, { role: req.user.role }),
    cancelPreview: preview,
  });
});

// —— Host inbox + onboarding ——
const hostInbox = asyncHandler(async (req, res) => {
  const data = await require('../services/hostInboxService').listHostInbox(req.user.userId, {
    bucket: req.query.bucket,
    page: req.query.page,
    limit: req.query.limit,
  });
  const { presentBooking } = require('../presenters/bookingPresenter');
  res.json({
    ...data,
    items: data.items.map((b) => ({
      ...presentBooking(b, { role: 'host' }),
      customer: b.CustomerID,
      space: b.SpaceID,
    })),
  });
});

const hostOnboarding = asyncHandler(async (req, res) => {
  const data = await require('../services/onboardingService').getHostOnboarding(req.user.userId);
  res.json(data);
});

// —— Host internal notes ——
const addHostNote = asyncHandler(async (req, res) => {
  const Booking = require('../models/Booking');
  const body = String(req.body.body || req.body.note || '').trim().slice(0, 2000);
  if (!body) throw new ValidationError('Ghi chú trống.');
  const booking = await Booking.findOne({
    _id: req.params.bookingId,
    HostID: req.user.userId,
  });
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');
  booking.HostInternalNotes = booking.HostInternalNotes || [];
  booking.HostInternalNotes.push({
    Body: body,
    AuthorID: req.user.userId,
    CreatedAt: new Date(),
  });
  // Keep last 50 notes
  if (booking.HostInternalNotes.length > 50) {
    booking.HostInternalNotes = booking.HostInternalNotes.slice(-50);
  }
  await booking.save();
  res.status(201).json({ notes: booking.HostInternalNotes });
});

const listHostNotes = asyncHandler(async (req, res) => {
  const Booking = require('../models/Booking');
  const booking = await Booking.findOne({
    _id: req.params.bookingId,
    HostID: req.user.userId,
  })
    .select('HostInternalNotes')
    .lean();
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');
  res.json({ notes: booking.HostInternalNotes || [] });
});

// —— Host space ops: buffer / cleanup / instant ——
const patchSpaceOps = asyncHandler(async (req, res) => {
  const Space = require('../models/Space');
  const updates = {};
  if (req.body.bufferBeforeMinutes != null) {
    updates.BufferBeforeMinutes = Math.max(0, Math.min(180, Number(req.body.bufferBeforeMinutes) || 0));
  }
  if (req.body.cleanupAfterMinutes != null) {
    updates.CleanupAfterMinutes = Math.max(0, Math.min(180, Number(req.body.cleanupAfterMinutes) || 0));
  }
  if (typeof req.body.instantBook === 'boolean') {
    updates.InstantBook = req.body.instantBook;
  }
  if (req.body.freeCancelHours != null) {
    updates.FreeCancelHours = Math.max(0, Math.min(168, Number(req.body.freeCancelHours) || 24));
  }
  const space = await Space.findOneAndUpdate(
    { _id: req.params.spaceId, HostID: req.user.userId },
    { $set: updates },
    { new: true }
  );
  if (!space) throw new NotFoundError('Không tìm thấy space.');
  res.json({ space });
});

// —— Marketing / consent (public policy text) ——
const privacyPolicy = asyncHandler(async (req, res) => {
  res.json({
    version: '2026-07',
    marketingOptInDefault: false,
    dataRetention: 'Booking/payment retained for accounting; account soft-delete supported.',
    contact: 'privacy@workhub.local',
  });
});

// —— Staff context ——
const myStaffMemberships = asyncHandler(async (req, res) => {
  const staffService = require('../services/staffService');
  const items = await staffService.listMyMemberships(req.user.userId);
  res.json({ memberships: items });
});

const myHostPermissions = asyncHandler(async (req, res) => {
  const staffService = require('../services/staffService');
  const { PERMS, roleHas } = require('../policies/permissions');
  if (req.user.role === 'host') {
    return res.json({
      hostOwnerId: req.user.userId,
      staffRole: 'owner',
      permissions: PERMS.owner,
      canFinance: true,
      canPaymentVerify: true,
    });
  }
  const preferred = req.get('x-host-owner-id') || null;
  const ctx = await staffService.resolveActingHostOwnerId(
    req.user.userId,
    req.user.role,
    preferred
  );
  res.json({
    hostOwnerId: ctx.hostOwnerId,
    staffRole: ctx.staffRole,
    permissions: PERMS[ctx.staffRole] || [],
    canFinance: roleHas(ctx.staffRole, 'finance:view'),
    canPaymentVerify: roleHas(ctx.staffRole, 'payment:verify'),
  });
});

const staffHostInbox = asyncHandler(async (req, res) => {
  const hostOwnerId = req.hostOwnerId || req.hostContext?.hostOwnerId || req.user.userId;
  const staffService = require('../services/staffService');
  const spaceFilter = await staffService.branchScopedSpaceFilter(
    req.hostContext || {
      hostOwnerId,
      isOwner: req.user.role === 'host',
      allowedBranchIds: null,
    }
  );
  const data = await require('../services/hostInboxService').listHostInbox(hostOwnerId, {
    bucket: req.query.bucket,
    page: req.query.page,
    limit: req.query.limit,
    spaceFilter,
  });
  res.json(data);
});

const staffReceptionToday = asyncHandler(async (req, res) => {
  const hostOwnerId = req.hostOwnerId || req.user.userId;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const Booking = require('../models/Booking');
  const { branchScopedSpaceFilter } = require('../services/staffService');
  const spaceFilter = await branchScopedSpaceFilter(req.hostContext);
  const filter = {
    HostID: hostOwnerId,
    Status: { $in: ['confirmed', 'in-use', 'pending', 'payment_under_review'] },
    StartTime: { $lte: end },
    EndTime: { $gte: start },
    ...(spaceFilter || {}),
  };
  const bookings = await Booking.find(filter)
    .populate('CustomerID', 'FullName Email')
    .populate('SpaceID', 'Name SpaceCode BranchID')
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
  const checkInService = require('../services/checkInService');
  const booking = await checkInService.checkInWithToken({
    hostId: hostOwnerId,
    token: req.body.token,
    code: req.body.code,
    hostContext: req.hostContext,
  });
  res.json({ booking, message: 'Check-in thành công.', hostOwnerId });
});

const staffHostCalendar = asyncHandler(async (req, res) => {
  const hostOwnerId = req.hostOwnerId || req.user.userId;
  const { assertBranchAccess } = require('../services/staffService');
  if (req.query.branchId) {
    assertBranchAccess(req.hostContext, req.query.branchId);
  } else if (req.hostContext && !req.hostContext.isOwner && req.hostContext.allowedBranchIds) {
    // Force first allowed branch if staff is branch-scoped and no branch provided
    req.query.branchId = req.hostContext.allowedBranchIds[0];
  }
  const calendarService = require('../services/calendarService');
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
  const bookingService = require('../services/bookingService');
  const Booking = require('../models/Booking');
  const bookingDoc = await Booking.findOne({
    _id: req.params.bookingId,
    HostID: hostOwnerId,
  }).select('SpaceID');
  if (!bookingDoc) {
    const { NotFoundError } = require('../utils/errors');
    throw new NotFoundError('Booking not found');
  }
  if (req.hostContext && !req.hostContext.isOwner && req.hostContext.allowedBranchIds) {
    const Space = require('../models/Space');
    const space = await Space.findById(bookingDoc.SpaceID).select('BranchID').lean();
    const { assertBranchAccess } = require('../services/staffService');
    assertBranchAccess(req.hostContext, space?.BranchID);
  }
  const booking = await bookingService.confirmBooking(hostOwnerId, req.params.bookingId);
  res.json({ booking, message: 'Đã xác nhận booking.', hostOwnerId });
});

const staffNoShow = asyncHandler(async (req, res) => {
  const hostOwnerId = req.hostOwnerId || req.user.userId;
  const checkInService = require('../services/checkInService');
  const booking = await checkInService.markNoShow({
    hostId: hostOwnerId,
    bookingId: req.params.bookingId,
    reason: req.body.reason,
    hostContext: req.hostContext,
  });
  res.json({ booking, message: 'Đã đánh dấu no-show.', hostOwnerId });
});

// —— Web Push ——
const pushVapidPublic = asyncHandler(async (req, res) => {
  const pushService = require('../services/pushService');
  res.json({ publicKey: pushService.publicVapidKey() });
});

const pushSubscribe = asyncHandler(async (req, res) => {
  const pushService = require('../services/pushService');
  const sub = await pushService.saveSubscription({
    userId: req.user.userId,
    endpoint: req.body.endpoint,
    keys: req.body.keys || {},
    userAgent: req.get('user-agent'),
  });
  res.status(201).json({ subscription: { id: sub._id, endpoint: sub.Endpoint } });
});

const pushUnsubscribe = asyncHandler(async (req, res) => {
  const pushService = require('../services/pushService');
  await pushService.revokeSubscription({
    userId: req.user.userId,
    endpoint: req.body.endpoint,
  });
  res.json({ message: 'Đã hủy đăng ký push.' });
});

// —— Admin force logout ——
const adminForceLogout = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!user) throw new NotFoundError('User not found');
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  try {
    const UserSession = require('../models/Session');
    await UserSession.updateMany(
      { UserID: user._id, RevokedAt: null },
      { $set: { RevokedAt: new Date() } }
    );
  } catch {
    /* ignore */
  }
  res.json({ message: 'Đã force logout user (tokenVersion bumped).' });
});

module.exports = {
  createCheckout,
  gatewayWebhook,
  listGatewayProviders,
  mockCompleteGateway,
  getGatewaySession,
  requestPayout,
  listPayouts,
  adminProcessPayout,
  listPlans,
  myMembership,
  subscribe,
  myCreditLedger,
  previewRecurring,
  createRecurring,
  listRecurring,
  cancelRecurring,
  fraudPreview,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  partnerListSpaces,
  partnerGetBooking,
  listSessions,
  logoutAll,
  i18nBundle,
  setLang,
  hostIcalFeed,
  listDeadLetters,
  discardDeadLetter,
  replayDeadLetter,
  retryJob,
  downloadJobFile,
  createGroupBooking,
  listGroupInvites,
  getGroupInvitePublic,
  rsvpGroupInvite,
  hostAdvancedReport,
  rumBeacon,
  mintCheckIn,
  scanCheckIn,
  markNoShow,
  getNotifyPrefs,
  updateNotifyPrefs,
  systemHealth,
  customerDashboard,
  upsertSeoRedirect,
  listSeoRedirects,
  deleteSeoRedirect,
  toggleSeoRedirect,
  alternativeSlots,
  publicAddOns,
  quoteBooking,
  bookingReceipt,
  exportLedgerCsv,
  enqueueLedgerExport,
  enqueueBookingsExport,
  getJobStatus,
  listMyJobs,
  reportReview,
  moderateReview,
  hostReplyReview,
  publicHostProfile,
  bookingTimeline,
  cancelPreview,
  hostInbox,
  hostOnboarding,
  adminForceLogout,
  addHostNote,
  listHostNotes,
  patchSpaceOps,
  privacyPolicy,
  myStaffMemberships,
  myHostPermissions,
  staffHostInbox,
  staffReceptionToday,
  staffScanCheckIn,
  staffHostCalendar,
  staffConfirmBooking,
  staffNoShow,
  pushVapidPublic,
  pushSubscribe,
  pushUnsubscribe,
};
