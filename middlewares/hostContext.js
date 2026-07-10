'use strict';

const HostProfile = require('../models/Host_Profile');
const {
  resolveActingHostOwnerId,
  assertBranchAccess,
  branchScopedSpaceFilter,
} = require('../services/staffService');
const { roleHas } = require('../policies/permissions');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

/**
 * After verifyToken: set req.hostOwnerId + req.hostContext for host owner or staff.
 *
 * req.hostContext = {
 *   hostOwnerId, staffRole, allowedBranchIds, isOwner, via
 * }
 */
async function resolveHostContext(req, res, next) {
  try {
    if (!req.user?.userId) return next(new UnauthorizedError());
    const preferred =
      req.get('x-host-owner-id') || req.query.hostOwnerId || req.body?.hostOwnerId || null;

    // Host owner path
    if (req.user.role === 'host') {
      const profile = await HostProfile.findOne({ UserID: req.user.userId }).select(
        'IsVerified VerificationStatus'
      );
      const ok =
        profile &&
        (profile.IsVerified === true || profile.VerificationStatus === 'approved');
      if (!ok) {
        return next(new ForbiddenError('Host chưa được xác minh.'));
      }
      req.hostOwnerId = String(req.user.userId);
      req.staffRole = 'owner';
      req.hostContextVia = 'host';
      req.hostContext = {
        hostOwnerId: String(req.user.userId),
        staffRole: 'owner',
        allowedBranchIds: null,
        isOwner: true,
        via: 'host',
      };
      return next();
    }

    // Staff path
    const ctx = await resolveActingHostOwnerId(req.user.userId, req.user.role, preferred);
    const ownerProfile = await HostProfile.findOne({ UserID: ctx.hostOwnerId }).select(
      'IsVerified VerificationStatus'
    );
    const ownerOk =
      ownerProfile &&
      (ownerProfile.IsVerified === true || ownerProfile.VerificationStatus === 'approved');
    if (!ownerOk) {
      return next(new ForbiddenError('Host owner chưa được xác minh.'));
    }
    req.hostOwnerId = ctx.hostOwnerId;
    req.staffRole = ctx.staffRole;
    req.hostContextVia = ctx.via;
    req.hostContext = {
      hostOwnerId: ctx.hostOwnerId,
      staffRole: ctx.staffRole,
      allowedBranchIds: ctx.allowedBranchIds,
      isOwner: false,
      via: ctx.via,
      staffMemberId: ctx.staffMemberId,
    };

    // Reject client-supplied branchId outside allowlist
    const branchHint =
      req.query.branchId || req.body?.branchId || req.get('x-branch-id') || null;
    if (branchHint) {
      try {
        assertBranchAccess(req.hostContext, branchHint);
      } catch (err) {
        return next(err);
      }
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

function requireStaffPermission(permission) {
  return (req, res, next) => {
    const role = req.staffRole || req.hostContext?.staffRole || 'owner';
    if (!roleHas(role, permission)) {
      return next(new ForbiddenError(`Thiếu quyền: ${permission}`));
    }
    return next();
  };
}

/**
 * Attach space-filter for staff branch scope onto req.branchSpaceFilter
 */
async function attachBranchSpaceFilter(req, res, next) {
  try {
    req.branchSpaceFilter = await branchScopedSpaceFilter(req.hostContext);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  resolveHostContext,
  requireStaffPermission,
  attachBranchSpaceFilter,
  assertBranchAccess,
};
