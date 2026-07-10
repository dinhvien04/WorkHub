'use strict';

/**
 * Default free-cancellation window and refund estimate (policy snapshot).
 * Hosts can override via branch FreeCancelHours later.
 */
function buildPolicySnapshot({
  freeCancelHours = 24,
  refundBeforeStartPercent = 100,
  refundAfterStartPercent = 0,
  currency = 'VND',
} = {}) {
  return {
    freeCancelHours,
    refundBeforeStartPercent,
    refundAfterStartPercent,
    currency,
    summary: `Hủy miễn phí trước ${freeCancelHours}h so với giờ bắt đầu; sau đó hoàn ${refundAfterStartPercent}%.`,
  };
}

/**
 * Preview cancellation refund eligibility for a booking.
 */
function evaluateCancellation(booking, { now = new Date() } = {}) {
  const policy = booking.CancellationPolicy || buildPolicySnapshot();
  const start = new Date(booking.StartTime);
  const msBefore = start - now;
  const freeMs = (policy.freeCancelHours || 24) * 3600000;
  const withinFree = msBefore >= freeMs;
  const started = now >= start;

  let refundPercent = 0;
  if (started) {
    refundPercent = policy.refundAfterStartPercent || 0;
  } else if (withinFree) {
    refundPercent = policy.refundBeforeStartPercent ?? 100;
  } else {
    // Between free window and start: partial (50% default if not specified)
    refundPercent = Math.round((policy.refundBeforeStartPercent ?? 100) * 0.5);
  }

  const successfulPaid = Number(booking._successfulPaid || 0);
  // Caller may pass successfulPaid; else estimate from deposit only
  const base = successfulPaid > 0 ? successfulPaid : Number(booking.DepositAmount || 0);
  const refundAmount = Math.round((base * refundPercent) / 100);

  return {
    policy,
    withinFreeWindow: withinFree && !started,
    canCancel: !['cancelled', 'completed', 'expired', 'rejected'].includes(booking.Status),
    refundPercent,
    refundAmount,
    processingNote: withinFree
      ? 'Hoàn trong 3–5 ngày làm việc nếu đã thanh toán.'
      : 'Hoàn một phần theo chính sách; thời gian xử lý 5–7 ngày.',
    hoursUntilStart: Math.max(0, Math.round(msBefore / 3600000)),
  };
}

module.exports = { buildPolicySnapshot, evaluateCancellation };
