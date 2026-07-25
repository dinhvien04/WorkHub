"use strict";

const crypto = require("crypto");
const asyncHandler = require("../utils/asyncHandler");
const staffService = require("../services/staffService");
const ApiKey = require("../models/ApiKey");
const Booking = require("../models/Booking");
const User = require("../models/User");
const Space = require("../models/Space");
const UserSession = require("../models/Session");
const calendarService = require("../services/calendarService");

const {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} = require("../utils/errors");
const schemas = require("../validators/schemas");

// —— Staff Management (Host) ——
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

// —— Staff Context ——
const myStaffMemberships = asyncHandler(async (req, res) => {
  const items = await staffService.listMyMemberships(req.user.userId);
  res.json({ memberships: items });
});

const myHostPermissions = asyncHandler(async (req, res) => {
  const { PERMS, roleHas } = require("../policies/permissions");
  if (req.user.role === "host") {
    return res.json({
      hostOwnerId: req.user.userId,
      staffRole: "owner",
      permissions: PERMS.owner,
      canFinance: true,
      canPaymentVerify: true,
    });
  }
  const preferred = req.get("x-host-owner-id") || null;
  const ctx = await staffService.resolveActingHostOwnerId(
    req.user.userId,
    req.user.role,
    preferred,
  );
  res.json({
    hostOwnerId: ctx.hostOwnerId,
    staffRole: ctx.staffRole,
    permissions: PERMS[ctx.staffRole] || [],
    canFinance: roleHas(ctx.staffRole, "finance:view"),
    canPaymentVerify: roleHas(ctx.staffRole, "payment:verify"),
  });
});

// —— Partner API Keys ——
const createApiKey = asyncHandler(async (req, res) => {
  if (req.user.role !== "host" && req.user.role !== "admin") {
    throw new ForbiddenError(
      "Chỉ host đã xác minh hoặc admin mới tạo API key.",
    );
  }
  const hostOwnerId =
    req.user.role === "admin" && req.body.hostOwnerId
      ? req.body.hostOwnerId
      : req.user.userId;

  if (req.user.role === "host") {
    const HostProfile = require("../models/Host_Profile");
    const profile = await HostProfile.findOne({
      UserID: req.user.userId,
    }).lean();
    if (!profile?.IsVerified) {
      throw new ForbiddenError("Host chưa được xác minh.");
    }
  }

  const requested = Array.isArray(req.body.scopes)
    ? req.body.scopes
    : ["bookings:read", "spaces:read"];
  const allow =
    req.user.role === "admin" ? ApiKey.ADMIN_SCOPES : ApiKey.HOST_SCOPES;
  let scopes = requested.filter((s) => allow.includes(s));
  if (scopes.includes("*") && req.user.role !== "admin") {
    throw new ForbiddenError("Wildcard scope chỉ dành cho admin.");
  }
  if (!scopes.length) scopes = ["bookings:read"];

  let branchIds = Array.isArray(req.body.allowedBranchIds)
    ? req.body.allowedBranchIds.map(String)
    : [];

  if (branchIds.length) {
    const Branch = require("../models/Branch");
    const owned = await Branch.find({
      _id: { $in: branchIds },
      HostID: hostOwnerId,
    }).select("_id");
    const ownedIds = owned.map((b) => String(b._id));
    const missing = branchIds.filter((id) => !ownedIds.includes(String(id)));
    if (missing.length) {
      throw new ValidationError(
        "allowedBranchIds chứa branch không thuộc host — request bị từ chối.",
      );
    }
    branchIds = owned.map((b) => b._id);
  }

  const allBranches = req.body.allBranches === true;
  if (!allBranches && branchIds.length === 0) {
    throw new ValidationError(
      "Phải chỉ định allBranches:true hoặc ít nhất một allowedBranchIds thuộc host.",
    );
  }

  if (req.user.role === "admin" && req.body.hostOwnerId) {
    const HostProfile = require("../models/Host_Profile");
    const profile = await HostProfile.findOne({ UserID: hostOwnerId }).lean();
    if (
      !profile ||
      !(
        profile.IsVerified === true || profile.VerificationStatus === "approved"
      )
    ) {
      throw new ValidationError("hostOwnerId phải là host đã xác minh.");
    }
  }

  const { raw, prefix, hash } = ApiKey.generate();
  const expiresAt = req.body.expiresAt
    ? new Date(req.body.expiresAt)
    : new Date(Date.now() + 90 * 24 * 3600000);

  const doc = await ApiKey.create({
    Name: String(req.body.name || "Partner key").slice(0, 100),
    OwnerUserID: req.user.userId,
    HostOwnerID: hostOwnerId,
    AllowedBranchIDs: allBranches ? [] : branchIds,
    AllBranches: allBranches,
    KeyPrefix: prefix,
    KeyHash: hash,
    Scopes: scopes,
    Status: "active",
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
      allBranches: doc.AllBranches,
      expiresAt: doc.ExpiresAt,
    },
    secret: raw,
    warning: "Store secret securely; it will not be shown again.",
  });
});

const listApiKeys = asyncHandler(async (req, res) => {
  const items = await ApiKey.find({ OwnerUserID: req.user.userId })
    .select("-KeyHash")
    .sort({ createdAt: -1 })
    .lean();
  res.json({ keys: items });
});

const revokeApiKey = asyncHandler(async (req, res) => {
  const doc = await ApiKey.findOneAndUpdate(
    { _id: req.params.id, OwnerUserID: req.user.userId },
    { $set: { Status: "revoked" } },
    { new: true },
  ).select("-KeyHash");
  if (!doc) throw new NotFoundError("API key not found");
  res.json({ key: doc });
});

// Partner data plane (API key auth) — tenant-scoped
const partnerListSpaces = asyncHandler(async (req, res) => {
  const filter = {
    Status: "available",
    HostID: req.apiKey.HostOwnerID || req.apiKey.OwnerUserID,
  };
  if (req.apiKey.AllBranches === false) {
    const ids = req.apiKey.AllowedBranchIDs || [];
    if (!ids.length) {
      return res.json({ spaces: [] });
    }
    filter.BranchID = { $in: ids };
  } else if (req.apiKey.AllowedBranchIDs?.length) {
    filter.BranchID = { $in: req.apiKey.AllowedBranchIDs };
  }
  const spaces = await Space.find(filter)
    .select("Name SpaceCode Category PricePerHour Capacity BranchID Status")
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
    .select(
      "Status StartTime EndTime TotalAmount SpaceID HostID BranchID Snapshot.SpaceCode Snapshot.SpaceName",
    )
    .lean();
  if (!booking) throw new NotFoundError("Booking not found");

  if (req.apiKey.AllBranches === false) {
    const ids = (req.apiKey.AllowedBranchIDs || []).map(String);
    if (!ids.length) throw new NotFoundError("Booking not found");
    const space = await Space.findById(booking.SpaceID)
      .select("BranchID")
      .lean();
    const branchId = booking.BranchID || space?.BranchID;
    if (!branchId || !ids.includes(String(branchId))) {
      throw new NotFoundError("Booking not found");
    }
  } else if (req.apiKey.AllowedBranchIDs?.length) {
    const space = await Space.findById(booking.SpaceID)
      .select("BranchID")
      .lean();
    const branchId = booking.BranchID || space?.BranchID;
    const allowed = req.apiKey.AllowedBranchIDs.map(String);
    if (!branchId || !allowed.includes(String(branchId))) {
      throw new NotFoundError("Booking not found");
    }
  }

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
    .select(
      "PublicSessionID UserAgent IP LastSeenAt ExpiresAt createdAt AuthMethod",
    )
    .sort({ LastSeenAt: -1 })
    .limit(20)
    .lean();
  res.json({
    sessions: items.map((s) => ({
      id: s.PublicSessionID || String(s._id),
      userAgent: s.UserAgent,
      ip: s.IP,
      lastSeenAt: s.LastSeenAt,
      expiresAt: s.ExpiresAt,
      createdAt: s.createdAt,
      authMethod: s.AuthMethod || null,
      current:
        req.user.publicSessionId &&
        s.PublicSessionID === req.user.publicSessionId,
    })),
  });
});

const revokeSession = asyncHandler(async (req, res) => {
  const id = String(req.params.id || "");
  const mongoose = require("mongoose");
  const base = { UserID: req.user.userId, RevokedAt: null };
  const filter =
    mongoose.isValidObjectId(id) &&
    String(new mongoose.Types.ObjectId(id)) === id
      ? { ...base, $or: [{ PublicSessionID: id }, { _id: id }] }
      : { ...base, PublicSessionID: id };
  const doc = await UserSession.findOneAndUpdate(
    filter,
    { $set: { RevokedAt: new Date() } },
    { new: true },
  );
  if (!doc) throw new NotFoundError("Session not found");
  if (
    req.user.publicSessionId &&
    doc.PublicSessionID === req.user.publicSessionId
  ) {
    res.clearCookie(require("../config/env").AUTH_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
  }
  res.json({
    message: "Đã thu hồi phiên.",
    id: doc.PublicSessionID || String(doc._id),
  });
});

const logoutAll = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId);
  if (!user) throw new NotFoundError("User not found");
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await UserSession.updateMany(
    { UserID: user._id, RevokedAt: null },
    { $set: { RevokedAt: new Date() } },
  );
  res.clearCookie(require("../config/env").AUTH_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });
  res.json({ message: "Đã đăng xuất tất cả thiết bị." });
});

// —— Host external calendar feed ——
function hashIcalToken(raw) {
  const secret =
    require("../config/env").ICAL_FEED_SECRET ||
    require("../config/env").JWT_SECRET;
  return crypto.createHmac("sha256", secret).update(String(raw)).digest("hex");
}

const rotateIcalToken = asyncHandler(async (req, res) => {
  const HostProfile = require("../models/Host_Profile");
  const raw = `ical_${crypto.randomBytes(24).toString("base64url")}`;
  const hash = hashIcalToken(raw);
  const expiresAt = new Date(Date.now() + 365 * 86400000);
  const profile = await HostProfile.findOneAndUpdate(
    { UserID: req.user.userId },
    {
      $set: {
        IcalTokenHash: hash,
        IcalTokenPrefix: raw.slice(0, 12),
        IcalTokenExpiresAt: expiresAt,
        IcalTokenRevokedAt: null,
      },
    },
    { new: true },
  );
  if (!profile) throw new NotFoundError("Host profile not found");
  const base = require("../config/env").PUBLIC_BASE_URL || "";
  const path = `/api/feeds/host/${req.user.userId}/calendar.ics?token=${encodeURIComponent(raw)}`;
  res.json({
    token: raw,
    prefix: profile.IcalTokenPrefix,
    expiresAt,
    feedUrl: base ? `${base}${path}` : path,
    warning: "Store token securely; shown once. Rotate to revoke previous.",
  });
});

const revokeIcalToken = asyncHandler(async (req, res) => {
  const HostProfile = require("../models/Host_Profile");
  const profile = await HostProfile.findOneAndUpdate(
    { UserID: req.user.userId },
    {
      $set: {
        IcalTokenHash: null,
        IcalTokenPrefix: "",
        IcalTokenRevokedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!profile) throw new NotFoundError("Host profile not found");
  res.json({ message: "iCal feed token revoked." });
});

const hostIcalFeed = asyncHandler(async (req, res) => {
  const hostId = req.params.hostId;
  const token = req.query.token;
  if (!token) return res.status(401).send("Invalid feed token");

  const HostProfile = require("../models/Host_Profile");
  const profile = await HostProfile.findOne({ UserID: hostId }).lean();
  if (!profile || !profile.IcalTokenHash || profile.IcalTokenRevokedAt) {
    return res.status(401).send("Invalid feed token");
  }
  if (
    profile.IcalTokenExpiresAt &&
    new Date(profile.IcalTokenExpiresAt) < new Date()
  ) {
    return res.status(401).send("Invalid feed token");
  }
  const expected = hashIcalToken(token);
  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(String(profile.IcalTokenHash)),
      )
    ) {
      return res.status(401).send("Invalid feed token");
    }
  } catch {
    return res.status(401).send("Invalid feed token");
  }

  const from = new Date();
  const to = new Date(Date.now() + 30 * 86400000);
  const data = await calendarService.getHostCalendar({ hostId, from, to });
  const blocks = (data.events || []).map((ev) => {
    const fake = {
      _id: ev.id,
      StartTime: ev.start,
      EndTime: ev.end,
      Snapshot: { SpaceName: ev.title || "Booking", Address: "" },
    };
    return calendarService
      .bookingToIcs(fake)
      .replace(/BEGIN:VCALENDAR[\s\S]*?BEGIN:VEVENT/, "BEGIN:VEVENT")
      .replace(/END:VCALENDAR\s*$/, "");
  });
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkHub//EN",
    ...blocks,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(ics);
});

// —— Admin force logout ——
const adminForceLogout = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!user) throw new NotFoundError("User not found");
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  try {
    await UserSession.updateMany(
      { UserID: user._id, RevokedAt: null },
      { $set: { RevokedAt: new Date() } },
    );
  } catch {
    /* ignore */
  }
  res.json({ message: "Đã force logout user (tokenVersion bumped)." });
});

module.exports = {
  listStaff,
  inviteStaff,
  acceptStaffInvite,
  revokeStaff,
  myStaffMemberships,
  myHostPermissions,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  partnerListSpaces,
  partnerGetBooking,
  listSessions,
  revokeSession,
  logoutAll,
  rotateIcalToken,
  revokeIcalToken,
  hostIcalFeed,
  adminForceLogout,
};
