'use strict';

const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const BookingSlot = require('../models/BookingSlot');
const Space = require('../models/Space');
const PaymentHistory = require('../models/Payment_History');
const logActivity = require('../utils/auditLogger');
const env = require('../config/env');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} = require('../utils/errors');

const ACTIVE_STATUSES = [
  'hold',
  'pending',
  'awaiting_payment',
  'payment_under_review',
  'confirmed',
  'in-use',
];

const allowedTransitions = {
  draft: ['hold', 'pending', 'cancelled'],
  hold: ['pending', 'awaiting_payment', 'cancelled', 'expired'],
  pending: ['confirmed', 'awaiting_payment', 'payment_under_review', 'cancelled', 'rejected'],
  awaiting_payment: ['payment_under_review', 'confirmed', 'cancelled', 'expired'],
  payment_under_review: ['confirmed', 'cancelled', 'rejected'],
  confirmed: ['in-use', 'cancelled', 'cancel_requested'],
  'in-use': ['completed'],
  cancel_requested: ['cancelled', 'confirmed'],
  completed: [],
  cancelled: [],
  rejected: [],
  expired: [],
};

function assertTransition(from, to) {
  const allowed = allowedTransitions[from] || [];
  if (!allowed.includes(to)) {
    throw new ValidationError(`Không thể chuyển trạng thái booking từ "${from}" sang "${to}".`);
  }
}

/**
 * Floor-start slot builder: every overlapping range shares at least one slot.
 * Cursor = floor(start / step); while cursor < end push cursor.
 */
function buildSlotStarts(start, end, slotMinutes = env.BOOKING_SLOT_MINUTES) {
  const step = slotMinutes * 60 * 1000;
  const slots = [];
  let cursor = new Date(Math.floor(start.getTime() / step) * step);
  while (cursor < end) {
    slots.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + step);
  }
  if (slots.length === 0) {
    slots.push(new Date(Math.floor(start.getTime() / step) * step));
  }
  return slots;
}

/**
 * Run work once. Never re-invoke on transaction failure.
 * ENABLE_TRANSACTIONS=false => non-transaction path only.
 */
async function withOptionalTransaction(work) {
  if (!env.ENABLE_TRANSACTIONS) {
    return work(null);
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    session.endSession();
  }
}

function validateBookingWindow(start, end) {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError('Ngày/giờ không hợp lệ.');
  }
  if (end <= start) throw new ValidationError('EndTime phải lớn hơn StartTime.');
  if (start.getTime() < Date.now() - 60_000) {
    throw new ValidationError('Không thể đặt phòng ở thời điểm trong quá khứ.');
  }

  const durationMs = end - start;
  const maxDurationMs = env.MAX_BOOKING_HOURS * 60 * 60 * 1000;
  if (durationMs <= 0 || durationMs > maxDurationMs) {
    throw new ValidationError(
      `Thời lượng đặt chỗ không hợp lệ (tối đa ${env.MAX_BOOKING_HOURS} giờ).`
    );
  }

  const maxAheadMs = env.MAX_BOOKING_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  if (start.getTime() - Date.now() > maxAheadMs) {
    throw new ValidationError(
      `Chỉ được đặt trước tối đa ${env.MAX_BOOKING_DAYS_AHEAD} ngày.`
    );
  }

  // Slot policy (floor-start): any start/end allowed; overlapping ranges share slots.
  // Documented: BOOKING_SLOT_MINUTES granularity locks partial overlaps.
}

async function createBooking({
  customerId,
  spaceId,
  startTime,
  endTime,
  note = '',
  couponCode = '',
  holdMinutes = 15,
  addOns = [],
  preferInstant = true,
}) {
  if (!spaceId || !startTime || !endTime) {
    throw new ValidationError('Thiếu thông tin đặt chỗ (spaceId, startTime, endTime).');
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  validateBookingWindow(start, end);

  const space = await Space.findById(spaceId).populate('BranchID', 'Name Address Timezone');
  if (!space) throw new NotFoundError('Không tìm thấy phòng.');
  if (space.Status !== 'available') {
    throw new ValidationError('Không gian hiện không khả dụng để đặt.');
  }

  // Platform kill switch (feature flag)
  try {
    const featureFlagService = require('./featureFlagService');
    const bookingOff = await featureFlagService.isEnabled('kill_switch_bookings', {
      userId: customerId,
      role: 'customer',
    });
    if (bookingOff) {
      throw new ValidationError(
        'Hệ thống tạm dừng nhận booking mới (kill switch). Vui lòng thử lại sau.'
      );
    }
  } catch (err) {
    if (err.statusCode) throw err;
  }

  // Blackout / maintenance windows
  try {
    const Blackout = require('../models/Blackout');
    const blocked = await Blackout.findOne({
      SpaceID: space._id,
      StartTime: { $lt: end },
      EndTime: { $gt: start },
    }).lean();
    if (blocked) {
      throw new ValidationError(
        `Không gian đang bảo trì/blackout: ${blocked.Reason || 'maintenance'}.`
      );
    }
  } catch (err) {
    if (err.statusCode) throw err;
  }

  // Fraud pre-check (rule-based)
  try {
    const User = require('../models/User');
    const fraudService = require('./fraudService');
    const user = await User.findById(customerId).select('createdAt').lean();
    const recentBookingCount = await Booking.countDocuments({
      CustomerID: customerId,
      createdAt: { $gte: new Date(Date.now() - 3600000) },
    });
    const hoursPreview = (end - start) / 3600000;
    const amountPreview = Math.round(hoursPreview * (space.PricePerHour || 0));
    const fraud = fraudService.scoreBookingAttempt({
      userCreatedAt: user?.createdAt,
      amount: amountPreview,
      recentBookingCount,
    });
    if (fraud.action === 'block') {
      throw new ValidationError('Yêu cầu đặt chỗ bị chặn bởi hệ thống an toàn. Liên hệ hỗ trợ.');
    }
  } catch (err) {
    if (err.statusCode) throw err;
  }

  const slotStarts = buildSlotStarts(start, end);
  const maxSlots = Math.ceil((env.MAX_BOOKING_HOURS * 60) / env.BOOKING_SLOT_MINUTES);
  if (slotStarts.length > maxSlots) {
    throw new ValidationError('Số lượng slot vượt giới hạn.');
  }

  // Server-side pricing rules (peak/weekend/long-stay …)
  let appliedPricingRules = [];
  let total;
  let depositFromQuote = null;
  try {
    const pricingService = require('./pricingService');
    const quote = await pricingService.quotePrice({
      hostId: space.HostID,
      spaceId: space._id,
      branchId: space.BranchID?._id || space.BranchID,
      start,
      end,
      basePricePerHour: space.PricePerHour || 0,
    });
    total = quote.totalAmount;
    depositFromQuote = quote.depositAmount;
    appliedPricingRules = quote.appliedRules || [];
  } catch {
    const hours = (end - start) / (1000 * 60 * 60);
    total = Math.round(hours * (space.PricePerHour || 0));
  }
  let discountAmount = 0;
  let appliedCoupon = null;

  const baseAmount = total;

  // Add-ons (server-priced) — atomic inventory reserve later after booking create
  const addOnLines = [];
  let addOnsTotal = 0;
  const inventoryReserves = []; // { addOnId, qty }
  if (Array.isArray(addOns) && addOns.length) {
    const AddOn = require('../models/AddOn');
    const hours = Math.max(0, (end - start) / 3600000);
    for (const item of addOns.slice(0, 20)) {
      const id = item.addOnId || item.id;
      if (!id) continue;
      const doc = await AddOn.findOne({
        _id: id,
        HostID: space.HostID,
        Status: 'active',
      }).lean();
      if (!doc) continue;
      const qty = Math.max(1, Math.min(99, Math.round(Number(item.quantity) || 1)));
      if (doc.Inventory != null && qty > doc.Inventory) {
        throw new ValidationError(`Add-on "${doc.Name}" không đủ tồn kho.`);
      }
      let unit = doc.Price || 0;
      let line = unit * qty;
      if (doc.Unit === 'hour') line = unit * qty * hours;
      if (doc.Unit === 'person') line = unit * qty;
      line = Math.round(line);
      addOnLines.push({
        AddOnID: doc._id,
        Name: doc.Name,
        UnitPrice: unit,
        Quantity: qty,
        LineTotal: line,
      });
      if (doc.Inventory != null) {
        inventoryReserves.push({ addOnId: doc._id, qty, name: doc.Name });
      }
      addOnsTotal += line;
    }
  }
  total = Math.round(baseAmount + addOnsTotal);

  if (couponCode) {
    const couponService = require('./couponService');
    const branchId = space.BranchID?._id || space.BranchID;
    const result = await couponService.validateCoupon({
      code: couponCode,
      userId: customerId,
      orderAmount: total,
      branchId,
      hostId: space.HostID,
    });
    discountAmount = result.discountAmount;
    total = result.finalAmount;
    appliedCoupon = result.coupon;
  }

  const deposit =
    space.DepositAmount > 0
      ? Math.min(space.DepositAmount, total)
      : depositFromQuote != null
        ? Math.min(depositFromQuote, total)
        : Math.round(total * 0.3);

  const isInstant = preferInstant && !!space.InstantBook;
  const initialStatus = isInstant ? 'confirmed' : 'pending';
  const cancellationPolicyService = require('./cancellationPolicyService');
  const cancellationPolicy = cancellationPolicyService.buildPolicySnapshot({
    freeCancelHours: space.FreeCancelHours || 24,
  });

  const holdMs = Math.min(Math.max(Number(holdMinutes) || 15, 5), 60) * 60 * 1000;
  const holdExpires = new Date(Date.now() + holdMs);

  const branch = space.BranchID;
  const snapshot = {
    BranchName: branch?.Name || '',
    SpaceName: space.Name || '',
    SpaceCode: space.SpaceCode || '',
    Address: branch?.Address || '',
    PricePerHour: space.PricePerHour || 0,
    Currency: 'VND',
    Timezone: branch?.Timezone || 'Asia/Ho_Chi_Minh',
  };

  const { withLock } = require('../utils/distributedLock');
  // Serialize concurrent booking attempts on the same space (Redis lock if available)
  return withLock(`booking:space:${spaceId}`, () =>
    withOptionalTransaction(async (session) => {
    // Expire stale holds for this space first
    await Booking.updateMany(
      {
        SpaceID: spaceId,
        Status: 'hold',
        HoldExpiresAt: { $lt: new Date() },
      },
      { $set: { Status: 'expired' } }
    );
    if (!session) {
      const expired = await Booking.find({
        SpaceID: spaceId,
        Status: 'expired',
      }).select('_id');
      if (expired.length) {
        await BookingSlot.deleteMany({ BookingID: { $in: expired.map((e) => e._id) } });
      }
    }

    // Buffer before + cleanup after: both new and existing bookings expand by same space policy.
    // Overlap iff existing.Start < end+cleanup+buffer && existing.End > start-buffer-cleanup
    const bufferBefore = Math.max(0, Number(space.BufferBeforeMinutes) || 0) * 60 * 1000;
    const cleanupAfter = Math.max(0, Number(space.CleanupAfterMinutes) || 0) * 60 * 1000;
    const qStart = new Date(start.getTime() - bufferBefore - cleanupAfter);
    const qEnd = new Date(end.getTime() + cleanupAfter + bufferBefore);

    let conflictQuery = Booking.findOne({
      SpaceID: spaceId,
      Status: { $in: ACTIVE_STATUSES },
      StartTime: { $lt: qEnd },
      EndTime: { $gt: qStart },
    });
    if (session) conflictQuery = conflictQuery.session(session);
    const conflict = await conflictQuery;
    if (conflict) {
      throw new ConflictError(
        bufferBefore || cleanupAfter
          ? 'Khung giờ trùng (kể cả buffer/cleanup). Vui lòng chọn giờ khác!'
          : 'Khung giờ này vừa có người khác đặt. Vui lòng chọn giờ khác!'
      );
    }

    const doc = {
      CustomerID: customerId,
      SpaceID: spaceId,
      HostID: space.HostID,
      StartTime: start,
      EndTime: end,
      TotalAmount: total,
      DepositAmount: deposit,
      BaseAmount: baseAmount,
      AddOnsTotal: addOnsTotal,
      AddOns: addOnLines,
      Status: initialStatus,
      InstantBook: isInstant,
      Note: note || '',
      HoldExpiresAt: isInstant ? null : holdExpires,
      CouponCode: appliedCoupon ? appliedCoupon.Code : '',
      DiscountAmount: discountAmount,
      Snapshot: snapshot,
      AppliedPricingRules: appliedPricingRules,
      CancellationPolicy: cancellationPolicy,
    };

    let booking;
    if (session) {
      [booking] = await Booking.create([doc], { session });
    } else {
      booking = await Booking.create(doc);
    }

    const slotDocs = slotStarts.map((SlotStart) => ({
      SpaceID: spaceId,
      BookingID: booking._id,
      SlotStart,
    }));

    try {
      if (session) {
        await BookingSlot.insertMany(slotDocs, { session, ordered: true });
      } else {
        await BookingSlot.insertMany(slotDocs, { ordered: true });
      }
    } catch (slotErr) {
      if (!session) {
        await Booking.deleteOne({ _id: booking._id });
        await BookingSlot.deleteMany({ BookingID: booking._id });
      }
      if (slotErr.code === 11000) {
        throw new ConflictError('Khung giờ này vừa có người khác đặt. Vui lòng chọn giờ khác!');
      }
      throw slotErr;
    }

    // Atomic inventory decrement (reject booking if race lost last unit)
    if (inventoryReserves.length) {
      const AddOn = require('../models/AddOn');
      const reserved = [];
      try {
        for (const r of inventoryReserves) {
          const ok = await AddOn.findOneAndUpdate(
            {
              _id: r.addOnId,
              Status: 'active',
              Inventory: { $gte: r.qty },
            },
            { $inc: { Inventory: -r.qty } },
            { new: true }
          );
          if (!ok) {
            throw new ConflictError(`Add-on "${r.name}" vừa hết tồn kho.`);
          }
          reserved.push(r);
        }
      } catch (invErr) {
        // Compensate inventory already reserved
        for (const r of reserved) {
          await AddOn.updateOne({ _id: r.addOnId }, { $inc: { Inventory: r.qty } });
        }
        if (!session) {
          await Booking.deleteOne({ _id: booking._id });
          await BookingSlot.deleteMany({ BookingID: booking._id });
        }
        throw invErr;
      }
      booking._inventoryReserves = reserved;
    }

    if (appliedCoupon) {
      try {
        const couponService = require('./couponService');
        await couponService.redeemCoupon({
          couponId: appliedCoupon._id,
          userId: customerId,
          bookingId: booking._id,
          discountAmount,
        });
      } catch (redeemErr) {
        // Must not keep discounted booking without redemption
        if (inventoryReserves.length) {
          const AddOn = require('../models/AddOn');
          for (const r of inventoryReserves) {
            await AddOn.updateOne({ _id: r.addOnId }, { $inc: { Inventory: r.qty } });
          }
        }
        if (!session) {
          await Booking.deleteOne({ _id: booking._id });
          await BookingSlot.deleteMany({ BookingID: booking._id });
        }
        throw redeemErr;
      }
    }

    await logActivity(
      customerId,
      'CREATE_BOOKING',
      'Booking',
      booking._id,
      `Khách hàng tạo đơn đặt chỗ trị giá ${total.toLocaleString('vi-VN')}đ`,
      'info'
    );
    try {
      require('../utils/metrics').incBookingsCreated();
    } catch {
      /* ignore */
    }

    try {
      const { notifyUser } = require('./notificationService');
      await notifyUser({
        userId: space.HostID,
        title: 'Booking mới',
        body: `${snapshot.SpaceName} · ${total.toLocaleString('vi-VN')}đ`,
        type: 'booking',
        entityType: 'Booking',
        entityId: booking._id,
        link: '/host/bookings',
      });
    } catch {
      /* ignore */
    }

    // Transactional emails (best-effort)
    try {
      const User = require('../models/User');
      const emailService = require('./emailService');
      const [customer, host] = await Promise.all([
        User.findById(customerId).select('Email FullName NotifyEmail').lean(),
        User.findById(space.HostID).select('Email FullName NotifyEmail').lean(),
      ]);
      if (customer?.Email && customer.NotifyEmail !== false) {
        emailService.safeSendTemplate('booking_created', {
          to: customer.Email,
          customerName: customer.FullName,
          spaceName: snapshot.SpaceName,
          startTime: booking.StartTime,
          endTime: booking.EndTime,
          totalAmount: booking.TotalAmount,
          bookingId: booking._id,
        });
      }
      if (host?.Email && host.NotifyEmail !== false) {
        emailService.safeSendTemplate('host_new_booking', {
          to: host.Email,
          hostName: host.FullName,
          spaceName: snapshot.SpaceName,
          startTime: booking.StartTime,
          endTime: booking.EndTime,
          totalAmount: booking.TotalAmount,
          bookingId: booking._id,
        });
      }
    } catch {
      /* ignore */
    }

    return booking;
  })
  );
}

async function confirmBooking(hostId, bookingId) {
  return withOptionalTransaction(async (session) => {
    const opts = { returnDocument: 'after', runValidators: true };
    if (session) opts.session = session;

    const booking = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        HostID: hostId,
        Status: { $in: ['pending', 'payment_under_review', 'awaiting_payment'] },
      },
      { $set: { Status: 'confirmed' } },
      opts
    );

    if (!booking) {
      let existsQ = Booking.findOne({ _id: bookingId });
      if (session) existsQ = existsQ.session(session);
      const exists = await existsQ;
      if (!exists) throw new NotFoundError('Không tìm thấy đơn hàng.');
      if (String(exists.HostID) !== String(hostId)) {
        throw new ForbiddenError('Bạn không có quyền xác nhận đơn này.');
      }
      throw new ValidationError('Đơn hàng không ở trạng thái chờ xác nhận.');
    }

    // Do not auto-mark all payments; host verifies payments explicitly
    await logActivity(hostId, 'CONFIRM_BOOKING', 'Booking', booking._id, 'Chủ cơ sở xác nhận đơn', 'success');

    try {
      const User = require('../models/User');
      const emailService = require('./emailService');
      const { notifyUser } = require('./notificationService');
      const customer = await User.findById(booking.CustomerID)
        .select('Email FullName NotifyEmail')
        .lean();
      await notifyUser({
        userId: booking.CustomerID,
        title: 'Booking đã xác nhận',
        body: booking.Snapshot?.SpaceName || String(booking._id),
        type: 'booking',
        entityType: 'Booking',
        entityId: booking._id,
        link: '/dashboard',
      });
      if (customer?.Email && customer.NotifyEmail !== false) {
        emailService.safeSendTemplate('booking_confirmed', {
          to: customer.Email,
          customerName: customer.FullName,
          spaceName: booking.Snapshot?.SpaceName,
          startTime: booking.StartTime,
          endTime: booking.EndTime,
          bookingId: booking._id,
        });
      }
    } catch {
      /* ignore */
    }

    return booking;
  });
}

async function checkInBooking(hostId, bookingId) {
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, HostID: hostId, Status: 'confirmed' },
    { $set: { Status: 'in-use', CheckInAt: new Date() } },
    { returnDocument: 'after', runValidators: true }
  );

  if (!booking) {
    const exists = await Booking.findOne({ _id: bookingId });
    if (!exists) throw new NotFoundError('Không tìm thấy đơn hàng.');
    if (String(exists.HostID) !== String(hostId)) {
      throw new ForbiddenError('Bạn không có quyền check-in đơn này.');
    }
    throw new ValidationError('Chỉ có thể nhận phòng với đơn đã được xác nhận.');
  }

  await logActivity(hostId, 'CHECKIN_BOOKING', 'Booking', booking._id, 'Chủ cơ sở check-in', 'info');
  return booking;
}

async function cancelBookingByHost(hostId, bookingId) {
  const booking = await Booking.findOne({ _id: bookingId, HostID: hostId });
  if (!booking) throw new NotFoundError('Không tìm thấy đơn hàng.');
  assertTransition(booking.Status, 'cancelled');

  booking.Status = 'cancelled';
  await booking.save();
  await BookingSlot.deleteMany({ BookingID: booking._id });

  await PaymentHistory.updateMany(
    { BookingID: bookingId, HostID: hostId, Status: 'pending' },
    { $set: { Status: 'failed', FailureReason: 'Booking cancelled by host' } }
  );

  await logActivity(hostId, 'CANCEL_BOOKING', 'Booking', booking._id, 'Chủ cơ sở hủy đơn', 'danger');
  return booking;
}

async function cancelBookingByCustomer(customerId, bookingId, reason = '') {
  const booking = await Booking.findOne({ _id: bookingId, CustomerID: customerId });
  if (!booking) throw new NotFoundError('Không tìm thấy đơn hàng của bạn.');
  if (
    !['pending', 'hold', 'awaiting_payment', 'payment_under_review', 'confirmed'].includes(
      booking.Status
    )
  ) {
    throw new ValidationError('Không thể hủy đơn ở trạng thái hiện tại.');
  }
  const cancellationPolicyService = require('./cancellationPolicyService');
  const successfulPaid = await PaymentHistory.aggregate([
    { $match: { BookingID: booking._id, Status: 'successful' } },
    { $group: { _id: null, sum: { $sum: '$Amount' } } },
  ]);
  const paid = successfulPaid[0]?.sum || 0;
  const cancelPreview = cancellationPolicyService.evaluateCancellation(
    { ...booking.toObject(), _successfulPaid: paid },
    { now: new Date() }
  );

  booking.Status = 'cancelled';
  booking.CancelReason = String(reason || '').slice(0, 500);
  booking.CancelledAt = new Date();
  booking.CancelledBy = customerId;
  await booking.save();
  await BookingSlot.deleteMany({ BookingID: booking._id });
  await PaymentHistory.updateMany(
    { BookingID: bookingId, CustomerID: customerId, Status: 'pending' },
    { $set: { Status: 'failed', FailureReason: 'Booking cancelled by customer' } }
  );
  await logActivity(customerId, 'CANCEL_BOOKING', 'Booking', booking._id, 'Khách hàng hủy đơn', 'warning');
  try {
    const { notifyUser } = require('./notificationService');
    await notifyUser({
      userId: booking.HostID,
      title: 'Khách hủy booking',
      body: booking.Snapshot?.SpaceName || String(booking._id),
      type: 'booking',
      entityType: 'Booking',
      entityId: booking._id,
      link: '/host/bookings',
    });
  } catch {
    /* ignore */
  }
  try {
    const User = require('../models/User');
    const emailService = require('./emailService');
    const [customer, host] = await Promise.all([
      User.findById(customerId).select('Email FullName NotifyEmail').lean(),
      User.findById(booking.HostID).select('Email FullName NotifyEmail').lean(),
    ]);
    const payload = {
      spaceName: booking.Snapshot?.SpaceName,
      startTime: booking.StartTime,
      reason: booking.CancelReason,
      bookingId: booking._id,
    };
    if (customer?.Email && customer.NotifyEmail !== false) {
      emailService.safeSendTemplate('booking_cancelled', {
        to: customer.Email,
        customerName: customer.FullName,
        ...payload,
      });
    }
    if (host?.Email && host.NotifyEmail !== false) {
      emailService.safeSendTemplate('booking_cancelled', {
        to: host.Email,
        customerName: host.FullName,
        ...payload,
        reason: payload.reason || 'customer_cancelled',
      });
    }
  } catch {
    /* ignore */
  }
  booking._cancelPreview = cancelPreview;
  return booking;
}

/**
 * Expire unpaid holds past HoldExpiresAt and free slots.
 * Includes legacy `pending` (createBooking default) plus hold/awaiting_payment.
 */
async function expireStaleHolds() {
  const now = new Date();
  const stale = await Booking.find({
    Status: { $in: ['pending', 'hold', 'awaiting_payment'] },
    HoldExpiresAt: { $ne: null, $lt: now },
  }).select('_id');
  if (!stale.length) return { modifiedCount: 0 };
  const ids = stale.map((s) => s._id);
  await Booking.updateMany(
    { _id: { $in: ids }, Status: { $in: ['pending', 'hold', 'awaiting_payment'] } },
    { $set: { Status: 'expired' } }
  );
  await BookingSlot.deleteMany({ BookingID: { $in: ids } });
  return { modifiedCount: ids.length };
}

async function completeExpiredBookings({ hostId = null } = {}) {
  const filter = {
    Status: 'in-use',
    EndTime: { $lt: new Date() },
  };
  if (hostId) filter.HostID = hostId;
  return Booking.updateMany(filter, { $set: { Status: 'completed' } });
}

module.exports = {
  allowedTransitions,
  assertTransition,
  buildSlotStarts,
  createBooking,
  confirmBooking,
  checkInBooking,
  cancelBookingByHost,
  cancelBookingByCustomer,
  completeExpiredBookings,
  expireStaleHolds,
  ACTIVE_STATUSES,
  validateBookingWindow,
};

// Re-export alternatives for convenience
module.exports.suggestAlternativeSlots = (...args) =>
  require('./availabilityService').suggestAlternativeSlots(...args);
