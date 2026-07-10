"use strict";

/**
 * Lightweight rule-based fraud score (0-100). Not ML.
 */
function scoreBookingAttempt({
  userCreatedAt,
  amount,
  recentBookingCount = 0,
  recentFailedPayments = 0,
  ipVelocity = 0,
}) {
  let score = 0;
  const reasons = [];

  const ageHours = userCreatedAt
    ? (Date.now() - new Date(userCreatedAt).getTime()) / 3600000
    : 999;
  if (ageHours < 1) {
    score += 25;
    reasons.push("new_account");
  }
  if (amount > 5_000_000) {
    score += 20;
    reasons.push("high_amount");
  }
  if (recentBookingCount >= 5) {
    score += 20;
    reasons.push("booking_velocity");
  }
  if (recentFailedPayments >= 3) {
    score += 25;
    reasons.push("failed_payments");
  }
  if (ipVelocity >= 10) {
    score += 15;
    reasons.push("ip_velocity");
  }

  score = Math.min(100, score);
  const action = score >= 70 ? "block" : score >= 40 ? "review" : "allow";
  return { score, action, reasons };
}

module.exports = { scoreBookingAttempt };
