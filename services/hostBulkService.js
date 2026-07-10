'use strict';

/**
 * Host bulk operations on spaces + blackouts.
 */
const Space = require('../models/Space');
const Branch = require('../models/Branch');
const Blackout = require('../models/Blackout');
const Booking = require('../models/Booking');
const { notifyUser } = require('./notificationService');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/errors');

const SPACE_STATUSES = ['available', 'maintenance', 'inactive'];

function assertIds(ids) {
  if (!Array.isArray(ids) || !ids.length) {
    throw new ValidationError('Thiếu danh sách id.');
  }
  if (ids.length > 100) throw new ValidationError('Tối đa 100 mục mỗi lần.');
  return ids.map(String);
}

/**
 * Bulk patch spaces owned by host.
 * body: { spaceIds, status?, pricePerHour?, depositAmount?, amenities?,
 *         instantBook?, freeCancelHours?, bufferBeforeMinutes?, cleanupAfterMinutes? }
 */
async function bulkUpdateSpaces({ hostId, spaceIds, patch }) {
  const ids = assertIds(spaceIds);
  const $set = {};

  if (patch.status != null) {
    if (!SPACE_STATUSES.includes(patch.status)) {
      throw new ValidationError('Status không hợp lệ (available|maintenance|inactive).');
    }
    $set.Status = patch.status;
  }
  if (patch.pricePerHour != null) {
    const p = Number(patch.pricePerHour);
    if (!Number.isFinite(p) || p < 0) throw new ValidationError('pricePerHour không hợp lệ.');
    $set.PricePerHour = Math.round(p);
  }
  if (patch.depositAmount != null) {
    const d = Number(patch.depositAmount);
    if (!Number.isFinite(d) || d < 0) throw new ValidationError('depositAmount không hợp lệ.');
    $set.DepositAmount = Math.round(d);
  }
  if (Array.isArray(patch.amenities)) {
    $set.Amenities = patch.amenities.map((a) => String(a).slice(0, 80)).filter(Boolean).slice(0, 40);
  }
  if (typeof patch.instantBook === 'boolean') {
    $set.InstantBook = patch.instantBook;
  }
  if (patch.freeCancelHours != null) {
    $set.FreeCancelHours = Math.max(0, Math.min(168, Number(patch.freeCancelHours) || 0));
  }
  if (patch.bufferBeforeMinutes != null) {
    $set.BufferBeforeMinutes = Math.max(0, Math.min(180, Number(patch.bufferBeforeMinutes) || 0));
  }
  if (patch.cleanupAfterMinutes != null) {
    $set.CleanupAfterMinutes = Math.max(0, Math.min(180, Number(patch.cleanupAfterMinutes) || 0));
  }

  if (!Object.keys($set).length) {
    throw new ValidationError('Không có trường nào để cập nhật.');
  }

  const r = await Space.updateMany(
    { _id: { $in: ids }, HostID: hostId },
    { $set }
  );

  return {
    matched: r.matchedCount ?? r.n,
    modified: r.modifiedCount ?? r.nModified,
    fields: Object.keys($set),
  };
}

/**
 * Create blackout; optionally notify customers with overlapping future bookings.
 */
async function createBlackoutWithNotify({
  hostId,
  spaceId,
  startTime,
  endTime,
  reason = 'maintenance',
  notifyCustomers = true,
}) {
  if (!spaceId) throw new ValidationError('Thiếu spaceId.');
  const space = await Space.findOne({ _id: spaceId, HostID: hostId });
  if (!space) throw new NotFoundError('Không tìm thấy space.');

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new ValidationError('Khoảng blackout không hợp lệ.');
  }

  const doc = await Blackout.create({
    HostID: hostId,
    SpaceID: spaceId,
    StartTime: start,
    EndTime: end,
    Reason: String(reason || 'maintenance').slice(0, 200),
    NotifyCustomers: !!notifyCustomers,
  });

  let notified = 0;
  if (notifyCustomers) {
    const bookings = await Booking.find({
      SpaceID: spaceId,
      Status: {
        $in: [
          'pending',
          'awaiting_payment',
          'payment_under_review',
          'confirmed',
          'hold',
        ],
      },
      StartTime: { $lt: end },
      EndTime: { $gt: start },
    })
      .select('CustomerID StartTime')
      .lean();

    const seen = new Set();
    for (const b of bookings) {
      const uid = String(b.CustomerID);
      if (seen.has(uid)) continue;
      seen.add(uid);
      try {
        await notifyUser({
          userId: b.CustomerID,
          title: 'Bảo trì / blackout',
          body: `Không gian ${space.Name || space.SpaceCode} tạm khóa: ${start.toLocaleString('vi-VN')} – ${end.toLocaleString('vi-VN')}. Lý do: ${doc.Reason}. Vui lòng đổi lịch nếu cần.`,
          type: 'booking',
          entityType: 'Booking',
          entityId: b._id,
        });
        notified += 1;
      } catch {
        /* ignore */
      }
    }
  }

  // Suggest alternative slots for first overlapping window (best effort)
  let alternatives = [];
  try {
    const availabilityService = require('./availabilityService');
    alternatives = await availabilityService.suggestAlternativeSlots({
      spaceId,
      startTime: start,
      endTime: end,
      max: 4,
    });
  } catch {
    alternatives = [];
  }

  return { blackout: doc, notified, alternatives };
}

async function deleteBlackout({ hostId, blackoutId }) {
  const doc = await Blackout.findOneAndDelete({ _id: blackoutId, HostID: hostId });
  if (!doc) throw new NotFoundError('Không tìm thấy blackout.');
  return { deleted: true, id: String(doc._id) };
}

/**
 * Admin/host branch publish status.
 */
async function setBranchStatus({ actorId, role, branchId, status, note = '' }) {
  const allowed =
    role === 'admin'
      ? ['active', 'inactive', 'maintenance']
      : ['active', 'inactive', 'maintenance'];
  if (!allowed.includes(status)) {
    throw new ValidationError('Status branch không hợp lệ.');
  }
  const branch = await Branch.findById(branchId);
  if (!branch) throw new NotFoundError('Không tìm thấy branch.');
  if (role !== 'admin' && String(branch.HostID) !== String(actorId)) {
    throw new ForbiddenError('Không có quyền.');
  }
  const prev = branch.Status;
  branch.Status = status;
  await branch.save();

  // Soft audit via activity if available
  try {
    const logActivity = require('../utils/auditLogger');
    await logActivity(
      actorId,
      'BRANCH_STATUS',
      'Branch',
      branch._id,
      `Status ${prev} → ${status}${note ? ': ' + note : ''}`,
      'info'
    );
  } catch {
    /* ignore */
  }

  return { branch, previousStatus: prev };
}

module.exports = {
  bulkUpdateSpaces,
  createBlackoutWithNotify,
  deleteBlackout,
  setBranchStatus,
  SPACE_STATUSES,
};
