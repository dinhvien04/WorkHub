'use strict';

/**
 * Safe DTO for API responses — never expose internal-only fields loosely.
 */
function presentBooking(booking, { role = 'customer' } = {}) {
  if (!booking) return null;
  const b = typeof booking.toObject === 'function' ? booking.toObject() : booking;
  const base = {
    id: b._id,
    status: b.Status,
    startTime: b.StartTime,
    endTime: b.EndTime,
    totalAmount: b.TotalAmount,
    depositAmount: b.DepositAmount,
    baseAmount: b.BaseAmount,
    addOnsTotal: b.AddOnsTotal,
    addOns: b.AddOns || [],
    discountAmount: b.DiscountAmount || 0,
    couponCode: b.CouponCode || '',
    note: b.Note || '',
    holdExpiresAt: b.HoldExpiresAt,
    instantBook: !!b.InstantBook,
    noShow: !!b.NoShow,
    snapshot: b.Snapshot || {},
    appliedPricingRules: b.AppliedPricingRules || [],
    cancellationPolicy: b.CancellationPolicy || null,
    checkInAt: b.CheckInAt,
    checkOutAt: b.CheckOutAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
  if (role === 'host' || role === 'admin') {
    base.customerId = b.CustomerID;
    base.hostId = b.HostID;
    base.spaceId = b.SpaceID;
    base.cancelReason = b.CancelReason;
  } else {
    base.spaceId = b.SpaceID;
    base.hostId = b.HostID;
  }
  return base;
}

function presentPayment(payment) {
  if (!payment) return null;
  const p = typeof payment.toObject === 'function' ? payment.toObject() : payment;
  return {
    id: p._id,
    bookingId: p.BookingID,
    amount: p.Amount,
    status: p.Status,
    method: p.PaymentMethod,
    transactionCode: p.TransactionCode,
    paidAt: p.PaidAt,
    createdAt: p.createdAt,
  };
}

module.exports = { presentBooking, presentPayment };
