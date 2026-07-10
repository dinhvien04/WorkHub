'use strict';

const HostProfile = require('../models/Host_Profile');
const { resolveActingHostOwnerId } = require('../services/staffService');
const { roleHas } = require('../policies/permissions');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

/**
 * After verifyToken: set req.hostOwnerId for host owner or staff.
 * Allows staff (any role user who is active StaffMember) to act on host data.
 */
async function resolveHostContext(req, res, next) {
  try {
    if (!req.user?.userId) return next(new UnauthorizedError());
    const preferred =
      req.get('x-host-owner-id') || req.query.hostOwnerId || req.body?.hostOwnerId || null;

    // Host owner path
    if (req.user.role === 'host') {
      const profile = await HostProfile.findOne({ UserID: req.user.userId }).select('IsVerified');
      if (!profile?.IsVerified) {
        return next(new ForbiddenError('Host chưa được xác minh.'));
      }
      req.hostOwnerId = String(req.user.userId);
      req.staffRole = 'owner';
      req.hostContextVia = 'host';
      return next();
    }

    // Staff path (customer/admin with staff membership)
    const ctx = await resolveActingHostOwnerId(req.user.userId, req.user.role, preferred);
    const ownerProfile = await HostProfile.findOne({ UserID: ctx.hostOwnerId }).select(
      'IsVerified'
    );
    if (!ownerProfile?.IsVerified) {
      return next(new ForbiddenError('Host owner chưa được xác minh.'));
    }
    req.hostOwnerId = ctx.hostOwnerId;
    req.staffRole = ctx.staffRole;
    req.hostContextVia = ctx.via;
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireStaffPermission(permission) {
  return (req, res, next) => {
    const role = req.staffRole || 'owner';
    if (!roleHas(role, permission)) {
      return next(new ForbiddenError(`Thiếu quyền: ${permission}`));
    }
    return next();
  };
}

module.exports = { resolveHostContext, requireStaffPermission };
