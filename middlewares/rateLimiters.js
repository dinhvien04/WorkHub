"use strict";

const rateLimit = require("express-rate-limit");
const {
  createMemoryStore,
  getRateLimitStore,
} = require("../utils/rateLimitStore");

const isTest = process.env.NODE_ENV === "test";

/**
 * Each express-rate-limit instance needs its own store (unique prefix).
 * Sharing one Map across limiters triggers ERR_ERL_STORE_REUSE.
 */
function makeLimiter({ windowMs, max, message, prefix }) {
  const store = createMemoryStore();
  // Tag for debugging / Redis key namespacing if upgraded later
  store._prefix = prefix || "rl";

  if (process.env.REDIS_URL && !isTest) {
    getRateLimitStore(windowMs)
      .then((s) => {
        // Clone redis adapter with prefix-aware keys via wrapper
        const wrapped = {
          async increment(key) {
            return s.increment(`${prefix}:${key}`);
          },
          async decrement(key) {
            return s.decrement(`${prefix}:${key}`);
          },
          async resetKey(key) {
            return s.resetKey(`${prefix}:${key}`);
          },
        };
        Object.assign(store, wrapped);
      })
      .catch(() => {});
  }

  return rateLimit({
    windowMs,
    max: isTest ? 10000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    message: { error: message, code: "RATE_LIMITED" },
    validate: { singleCount: false },
  });
}

const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Quá nhiều lần đăng nhập. Vui lòng thử lại sau.",
  prefix: "login",
});

const registerLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Quá nhiều lần đăng ký. Vui lòng thử lại sau.",
  prefix: "register",
});

const passwordLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau.",
  prefix: "password",
});

const bookingLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Quá nhiều yêu cầu đặt chỗ. Vui lòng thử lại sau.",
  prefix: "booking",
});

const paymentLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Quá nhiều yêu cầu thanh toán. Vui lòng thử lại sau.",
  prefix: "payment",
});

const searchLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: "Quá nhiều tìm kiếm. Thử lại sau.",
  prefix: "search",
});

const rumLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Quá nhiều RUM beacon.",
  prefix: "rum",
});

const rsvpLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Quá nhiều RSVP. Thử lại sau.",
  prefix: "rsvp",
});

const reviewReportLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Quá nhiều báo cáo review.",
  prefix: "review-report",
});

const webauthnLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: "Quá nhiều yêu cầu WebAuthn.",
  prefix: "webauthn",
});

const emailVerifyLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Quá nhiều yêu cầu xác minh email.",
  prefix: "email-verify",
});

const checkInLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Quá nhiều lần quét check-in.",
  prefix: "checkin",
});

const icalLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Quá nhiều yêu cầu iCal.",
  prefix: "ical",
});

const staffInviteAcceptLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Quá nhiều lần accept staff invite.",
  prefix: "staff-accept",
});

/**
 * Global catch-all API limiter — applied to all /api/ routes.
 * Protects unauthenticated endpoints (admin, host management, etc.) from scanning.
 */
const globalApiLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 200,
  message: "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
  prefix: "global",
});

module.exports = {
  loginLimiter,
  registerLimiter,
  passwordLimiter,
  bookingLimiter,
  paymentLimiter,
  searchLimiter,
  rumLimiter,
  rsvpLimiter,
  reviewReportLimiter,
  webauthnLimiter,
  emailVerifyLimiter,
  checkInLimiter,
  icalLimiter,
  staffInviteAcceptLimiter,
  globalApiLimiter,
};
