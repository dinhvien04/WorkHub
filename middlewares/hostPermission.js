'use strict';

const { assertHostPermission, getStaffRole, roleHas } = require('../policies/permissions');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

/**
 * Ensure authenticated host owner (or staff) has a permission.
 * For current product, host routes use req.user.userId as HostOwnerID.
 * Staff members with matching HostOwnerID can act if they hold the permission.
 */
function requireHostPermission(permission) {
  return async (req, res, next) => {
    try {
      if (!req.user?.userId) return next(new UnauthorizedError());
      const hostOwnerId = req.user.userId;
      // Owner path: host role users managing own resources
      if (req.user.role === 'host') {
        const role = await getStaffRole(hostOwnerId, req.user.userId);
        // getStaffRole returns 'owner' when same id
        if (!roleHas(role, permission) && role !== 'owner') {
          return next(new ForbiddenError('Không có quyền (staff).'));
        }
        // owner always passes roleHas via *
        await assertHostPermission(hostOwnerId, req.user.userId, permission);
        req.hostContext = { hostOwnerId, staffRole: role || 'owner' };
        return next();
      }
      return next(new ForbiddenError('Chỉ host/staff được truy cập.'));
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Finance-only: hide finance endpoints from receptionist-class roles.
 * Host owners always allowed.
 */
function requireFinanceAccess() {
  return requireHostPermission('finance:view');
}

function requirePaymentVerify() {
  return requireHostPermission('payment:verify');
}

module.exports = {
  requireHostPermission,
  requireFinanceAccess,
  requirePaymentVerify,
};
