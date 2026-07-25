'use strict';

const StaffMember = require('../models/StaffMember');

const PERMS = {
  owner: ['*'],
  manager: ['branch:manage', 'space:manage', 'booking:manage', 'calendar:view', 'message:reply', 'incident:create'],
  receptionist: ['booking:checkin', 'calendar:view', 'reception:view', 'message:reply'],
  finance: ['payment:verify', 'finance:view', 'refund:manage', 'report:view'],
  content_editor: ['listing:edit', 'media:manage'],
  support: ['message:reply', 'ticket:manage'],
};

async function getStaffRole(hostOwnerId, userId) {
  if (String(hostOwnerId) === String(userId)) return 'owner';
  const staff = await StaffMember.findOne({
    HostOwnerID: hostOwnerId,
    UserID: userId,
    Status: 'active',
  }).lean();
  return staff ? staff.Role : null;
}

function roleHas(role, permission) {
  if (!role) return false;
  const list = PERMS[role] || [];
  return list.includes('*') || list.includes(permission);
}

async function assertHostPermission(hostOwnerId, userId, permission) {
  const role = await getStaffRole(hostOwnerId, userId);
  if (!roleHas(role, permission)) {
    const err = new Error('Không có quyền thực hiện thao tác này.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    err.isOperational = true;
    throw err;
  }
  return role;
}

module.exports = { PERMS, getStaffRole, roleHas, assertHostPermission };
