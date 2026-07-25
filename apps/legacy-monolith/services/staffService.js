"use strict";

const crypto = require("crypto");
const StaffMember = require("../models/StaffMember");
const User = require("../models/User");
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require("../utils/errors");
const { notifyUser } = require("./notificationService");
const { ROLES } = StaffMember;

async function listStaff(ownerId) {
  return StaffMember.find({ HostOwnerID: ownerId })
    .populate("UserID", "FullName Email Role Status")
    .sort({ createdAt: -1 })
    .lean();
}

async function inviteStaff({
  ownerId,
  email,
  role,
  branchIds = [],
  allBranches = false,
}) {
  if (!ROLES.includes(role) || role === "owner") {
    throw new ValidationError("Role không hợp lệ.");
  }
  const user = await User.findOne({
    Email: String(email).toLowerCase().trim(),
  });
  if (!user) throw new NotFoundError("User chưa đăng ký với email này.");
  if (String(user._id) === String(ownerId)) {
    throw new ValidationError("Không thể mời chính mình.");
  }

  const ids = Array.isArray(branchIds)
    ? branchIds.filter(Boolean).map(String)
    : [];
  const grantAll = allBranches === true;

  // Verify every assigned branch belongs to the host — reject mixed lists
  if (!grantAll && ids.length > 0) {
    const Branch = require("../models/Branch");
    const owned = await Branch.find({
      _id: { $in: ids },
      HostID: ownerId,
    })
      .select("_id")
      .lean();
    if (owned.length !== ids.length) {
      throw new ValidationError(
        "Một hoặc nhiều branch không thuộc host — từ chối invite.",
      );
    }
  }

  const token = crypto.randomBytes(24).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const env = require("../config/env");

  try {
    // Invalidate any previous invite token by overwriting hash
    const staff = await StaffMember.findOneAndUpdate(
      { HostOwnerID: ownerId, UserID: user._id },
      {
        HostOwnerID: ownerId,
        UserID: user._id,
        Role: role,
        BranchIDs: grantAll ? [] : ids,
        AllBranches: grantAll,
        Status: "invited",
        InviteTokenHash: hash,
        InviteExpiresAt: new Date(Date.now() + 7 * 86400000),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await notifyUser({
      userId: user._id,
      title: "Lời mời staff WorkHub",
      body: env.isProduction
        ? `Bạn được mời làm ${role}. Kiểm tra email để chấp nhận.`
        : `Bạn được mời làm ${role}. Token (dev): ${token.slice(0, 8)}…`,
      type: "host",
      entityType: "StaffMember",
      entityId: staff._id,
      link: "/host/staff",
    });
    // Never return raw invite token in production — deliver via verified channel only
    const result = { staff };
    if (!env.isProduction) result.inviteToken = token;
    else result.inviteTokenDelivered = true;
    return result;
  } catch (err) {
    if (err.code === 11000) throw new ConflictError("Staff đã tồn tại.");
    throw err;
  }
}

async function acceptInvite({ userId, token }) {
  const hash = crypto.createHash("sha256").update(String(token)).digest("hex");
  const staff = await StaffMember.findOne({
    UserID: userId,
    InviteTokenHash: hash,
    Status: "invited",
    InviteExpiresAt: { $gt: new Date() },
  });
  if (!staff) throw new NotFoundError("Invite không hợp lệ hoặc hết hạn.");
  staff.Status = "active";
  staff.InviteTokenHash = null;
  staff.InviteExpiresAt = null;
  await staff.save();
  return staff;
}

async function revokeStaff({ ownerId, staffId }) {
  const staff = await StaffMember.findOne({
    _id: staffId,
    HostOwnerID: ownerId,
  });
  if (!staff) throw new NotFoundError("Không tìm thấy staff.");
  staff.Status = "revoked";
  await staff.save();
  return staff;
}

/** Memberships where current user is active staff (not owner). */
async function listMyMemberships(userId) {
  return StaffMember.find({ UserID: userId, Status: "active" })
    .populate("HostOwnerID", "FullName Email")
    .lean();
}

/**
 * Resolve which host owner this actor operates as.
 * - Host role: self (all branches)
 * - Staff: X-Host-Owner-Id header or single membership + BranchIDs scope
 */
async function resolveActingHostOwnerId(userId, role, preferredOwnerId = null) {
  if (role === "host") {
    return {
      hostOwnerId: String(userId),
      staffRole: "owner",
      via: "host",
      isOwner: true,
      allowedBranchIds: null, // null = all branches
      staffMemberId: null,
    };
  }
  const memberships = await StaffMember.find({
    UserID: userId,
    Status: "active",
  }).lean();
  if (!memberships.length) {
    throw new ForbiddenError("Bạn không phải host hoặc staff.");
  }
  let m;
  if (preferredOwnerId) {
    m = memberships.find(
      (x) => String(x.HostOwnerID) === String(preferredOwnerId),
    );
    if (!m) throw new ForbiddenError("Không có quyền staff trên host này.");
  } else if (memberships.length === 1) {
    m = memberships[0];
  } else {
    throw new ValidationError("Chọn host: gửi header X-Host-Owner-Id.");
  }
  // AllBranches=true → all; AllBranches=false + [] → deny; else listed branches
  // Legacy: AllBranches undefined + empty BranchIDs → deny (no silent all-access)
  let allowedBranchIds;
  if (m.AllBranches === true) {
    allowedBranchIds = null; // null = all branches
  } else {
    const branchIds = Array.isArray(m.BranchIDs) ? m.BranchIDs.map(String) : [];
    allowedBranchIds = branchIds; // may be [] = deny all
  }
  return {
    hostOwnerId: String(m.HostOwnerID),
    staffRole: m.Role,
    via: "staff",
    isOwner: false,
    allowedBranchIds,
    allBranches: m.AllBranches === true,
    staffMemberId: String(m._id),
  };
}

/**
 * Assert staff may access a branch.
 * Owners and AllBranches (allowedBranchIds === null) pass.
 * Empty allowlist [] denies everything.
 */
function assertBranchAccess(hostContext, branchId) {
  if (!hostContext || hostContext.isOwner) return true;
  if (hostContext.allowedBranchIds === null) return true; // all branches
  if (
    Array.isArray(hostContext.allowedBranchIds) &&
    hostContext.allowedBranchIds.length === 0
  ) {
    throw new ForbiddenError("Staff không có chi nhánh được gán.");
  }
  if (!branchId) {
    throw new ForbiddenError("Thiếu branch scope cho thao tác staff.");
  }
  if (!hostContext.allowedBranchIds.includes(String(branchId))) {
    throw new ForbiddenError("Không có quyền trên chi nhánh này.");
  }
  return true;
}

/**
 * Filter bookings/spaces query by staff branch scope via Space.BranchID.
 * Returns null for no restriction, or { SpaceID: { $in } }.
 * Empty allowlist → { SpaceID: { $in: [] } } (deny all, never "all branches").
 */
async function branchScopedSpaceFilter(hostContext) {
  if (!hostContext || hostContext.isOwner) {
    return null;
  }
  if (hostContext.allowedBranchIds === null) {
    return null; // AllBranches
  }
  if (
    Array.isArray(hostContext.allowedBranchIds) &&
    hostContext.allowedBranchIds.length === 0
  ) {
    return { SpaceID: { $in: [] } };
  }
  const Space = require("../models/Space");
  const spaces = await Space.find({
    HostID: hostContext.hostOwnerId,
    BranchID: { $in: hostContext.allowedBranchIds },
  })
    .select("_id")
    .lean();
  return { SpaceID: { $in: spaces.map((s) => s._id) } };
}

module.exports = {
  listStaff,
  inviteStaff,
  acceptInvite,
  revokeStaff,
  listMyMemberships,
  resolveActingHostOwnerId,
  assertBranchAccess,
  branchScopedSpaceFilter,
  ROLES,
};
