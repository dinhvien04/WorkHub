'use strict';

const crypto = require('crypto');
const StaffMember = require('../models/StaffMember');
const User = require('../models/User');
const { ValidationError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/errors');
const { notifyUser } = require('./notificationService');
const { ROLES } = StaffMember;

async function listStaff(ownerId) {
  return StaffMember.find({ HostOwnerID: ownerId })
    .populate('UserID', 'FullName Email Role Status')
    .sort({ createdAt: -1 })
    .lean();
}

async function inviteStaff({ ownerId, email, role, branchIds = [] }) {
  if (!ROLES.includes(role) || role === 'owner') {
    throw new ValidationError('Role không hợp lệ.');
  }
  const user = await User.findOne({ Email: String(email).toLowerCase().trim() });
  if (!user) throw new NotFoundError('User chưa đăng ký với email này.');
  if (String(user._id) === String(ownerId)) {
    throw new ValidationError('Không thể mời chính mình.');
  }

  const token = crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const staff = await StaffMember.findOneAndUpdate(
      { HostOwnerID: ownerId, UserID: user._id },
      {
        HostOwnerID: ownerId,
        UserID: user._id,
        Role: role,
        BranchIDs: branchIds,
        Status: 'invited',
        InviteTokenHash: hash,
        InviteExpiresAt: new Date(Date.now() + 7 * 86400000),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await notifyUser({
      userId: user._id,
      title: 'Lời mời staff WorkHub',
      body: `Bạn được mời làm ${role}. Token (dev): ${token.slice(0, 8)}…`,
      type: 'host',
      entityType: 'StaffMember',
      entityId: staff._id,
      link: '/host/staff',
    });
    return { staff, inviteToken: token };
  } catch (err) {
    if (err.code === 11000) throw new ConflictError('Staff đã tồn tại.');
    throw err;
  }
}

async function acceptInvite({ userId, token }) {
  const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const staff = await StaffMember.findOne({
    UserID: userId,
    InviteTokenHash: hash,
    Status: 'invited',
    InviteExpiresAt: { $gt: new Date() },
  });
  if (!staff) throw new NotFoundError('Invite không hợp lệ hoặc hết hạn.');
  staff.Status = 'active';
  staff.InviteTokenHash = null;
  staff.InviteExpiresAt = null;
  await staff.save();
  return staff;
}

async function revokeStaff({ ownerId, staffId }) {
  const staff = await StaffMember.findOne({ _id: staffId, HostOwnerID: ownerId });
  if (!staff) throw new NotFoundError('Không tìm thấy staff.');
  staff.Status = 'revoked';
  await staff.save();
  return staff;
}

/** Memberships where current user is active staff (not owner). */
async function listMyMemberships(userId) {
  return StaffMember.find({ UserID: userId, Status: 'active' })
    .populate('HostOwnerID', 'FullName Email')
    .lean();
}

/**
 * Resolve which host owner this actor operates as.
 * - Host role: self
 * - Staff: X-Host-Owner-Id header or single membership
 */
async function resolveActingHostOwnerId(userId, role, preferredOwnerId = null) {
  if (role === 'host') {
    return { hostOwnerId: String(userId), staffRole: 'owner', via: 'host' };
  }
  const memberships = await StaffMember.find({ UserID: userId, Status: 'active' }).lean();
  if (!memberships.length) {
    throw new ForbiddenError('Bạn không phải host hoặc staff.');
  }
  if (preferredOwnerId) {
    const m = memberships.find((x) => String(x.HostOwnerID) === String(preferredOwnerId));
    if (!m) throw new ForbiddenError('Không có quyền staff trên host này.');
    return { hostOwnerId: String(m.HostOwnerID), staffRole: m.Role, via: 'staff' };
  }
  if (memberships.length === 1) {
    return {
      hostOwnerId: String(memberships[0].HostOwnerID),
      staffRole: memberships[0].Role,
      via: 'staff',
    };
  }
  throw new ValidationError('Chọn host: gửi header X-Host-Owner-Id.');
}

module.exports = {
  listStaff,
  inviteStaff,
  acceptInvite,
  revokeStaff,
  listMyMemberships,
  resolveActingHostOwnerId,
  ROLES,
};
