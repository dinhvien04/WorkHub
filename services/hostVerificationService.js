'use strict';

/**
 * Host verification state machine + private document signed URL.
 */
const crypto = require('crypto');
const HostProfile = require('../models/Host_Profile');
const User = require('../models/User');
const env = require('../config/env');
const logActivity = require('../utils/auditLogger');
const { notifyUser } = require('./notificationService');
const {
  ValidationError,
  NotFoundError,
} = require('../utils/errors');

const STATES = [
  'pending',
  'needs_info',
  'approved',
  'rejected',
  'suspended',
  'revoked',
];

const TRANSITIONS = {
  pending: ['needs_info', 'approved', 'rejected'],
  needs_info: ['pending', 'approved', 'rejected'],
  approved: ['suspended', 'revoked'],
  rejected: ['pending', 'needs_info'],
  suspended: ['approved', 'revoked'],
  revoked: ['pending'],
};

function normalizeState(profile) {
  if (profile.VerificationStatus && STATES.includes(profile.VerificationStatus)) {
    return profile.VerificationStatus;
  }
  return profile.IsVerified ? 'approved' : 'pending';
}

function assertTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new ValidationError(`Không thể chuyển verification từ "${from}" sang "${to}".`);
  }
}

/**
 * Signed short-lived URL token for verification document (not a real private blob store).
 * Client still needs host/admin auth to redeem; token proves intent + expiry.
 */
function mintDocumentAccessToken({ hostProfileId, actorId, ttlMinutes = 15 }) {
  const payload = {
    hp: String(hostProfileId),
    a: String(actorId),
    exp: Date.now() + ttlMinutes * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function verifyDocumentAccessToken(token) {
  if (!token || !String(token).includes('.')) return null;
  const [body, sig] = String(token).split('.');
  const expected = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(body)
    .digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function setVerificationStatus({
  adminId,
  hostProfileId,
  status,
  reason = '',
  note = '',
}) {
  if (!STATES.includes(status)) {
    throw new ValidationError(`Status phải là: ${STATES.join(', ')}`);
  }
  const profile = await HostProfile.findById(hostProfileId);
  if (!profile) throw new NotFoundError('Không tìm thấy hồ sơ host.');

  const from = normalizeState(profile);
  if (from !== status) assertTransition(from, status);

  profile.VerificationStatus = status;
  profile.IsVerified = status === 'approved';
  profile.VerificationReason = String(reason || '').slice(0, 500);
  profile.VerificationNote = String(note || '').slice(0, 2000);
  profile.VerificationUpdatedAt = new Date();
  profile.VerificationUpdatedBy = adminId;
  await profile.save();

  // Sync user status
  if (status === 'approved') {
    await User.findByIdAndUpdate(profile.UserID, {
      $set: { Status: 'active' },
      $inc: { tokenVersion: 1 },
    });
  } else if (['rejected', 'suspended', 'revoked'].includes(status)) {
    await User.findByIdAndUpdate(profile.UserID, {
      $set: { Status: status === 'rejected' ? 'inactive' : 'inactive' },
      $inc: { tokenVersion: 1 },
    });
  }

  await logActivity(
    adminId,
    'HOST_VERIFICATION',
    'HostProfile',
    profile._id,
    `${from} → ${status}${reason ? ': ' + reason : ''}`,
    status === 'approved' ? 'success' : 'warning'
  );

  try {
    await notifyUser({
      userId: profile.UserID,
      title: `Xác minh host: ${status}`,
      body: reason || note || `Trạng thái hồ sơ: ${status}`,
      type: 'admin',
      entityType: 'HostProfile',
      entityId: profile._id,
      link: '/host/onboarding',
    });
  } catch {
    /* ignore */
  }

  return {
    hostProfileId: profile._id,
    previousStatus: from,
    status,
    isVerified: profile.IsVerified,
    reason: profile.VerificationReason,
    note: profile.VerificationNote,
  };
}

async function listHostsByVerification({ status = null, limit = 50 } = {}) {
  const q = {};
  if (status && STATES.includes(status)) {
    if (status === 'pending') {
      q.$or = [
        { VerificationStatus: 'pending' },
        { VerificationStatus: { $exists: false }, IsVerified: false },
        { VerificationStatus: null, IsVerified: false },
      ];
    } else if (status === 'approved') {
      q.$or = [{ VerificationStatus: 'approved' }, { IsVerified: true }];
    } else {
      q.VerificationStatus = status;
    }
  }
  return HostProfile.find(q)
    .populate('UserID', 'FullName Email Status')
    .sort({ updatedAt: -1 })
    .limit(Math.min(100, limit))
    .lean();
}

module.exports = {
  STATES,
  TRANSITIONS,
  normalizeState,
  setVerificationStatus,
  listHostsByVerification,
  mintDocumentAccessToken,
  verifyDocumentAccessToken,
};
