'use strict';

const rateLimit = require('express-rate-limit');
const { createMemoryStore, getRateLimitStore } = require('../utils/rateLimitStore');

const isTest = process.env.NODE_ENV === 'test';

// Shared stores per window (memory by default; Redis when REDIS_URL + client available)
const store15m = createMemoryStore();
const store1h = createMemoryStore();

// Best-effort upgrade to Redis after boot (non-blocking)
if (process.env.REDIS_URL && !isTest) {
  getRateLimitStore(15 * 60 * 1000)
    .then((s) => {
      Object.assign(store15m, s);
    })
    .catch(() => {});
  getRateLimitStore(60 * 60 * 1000)
    .then((s) => {
      Object.assign(store1h, s);
    })
    .catch(() => {});
}

function makeLimiter({ windowMs, max, message, store }) {
  return rateLimit({
    windowMs,
    max: isTest ? 10000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    message: { error: message, code: 'RATE_LIMITED' },
  });
}

const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Quá nhiều lần đăng nhập. Vui lòng thử lại sau.',
  store: store15m,
});

const registerLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Quá nhiều lần đăng ký. Vui lòng thử lại sau.',
  store: store1h,
});

const passwordLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau.',
  store: store15m,
});

const bookingLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Quá nhiều yêu cầu đặt chỗ. Vui lòng thử lại sau.',
  store: store15m,
});

const paymentLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Quá nhiều yêu cầu thanh toán. Vui lòng thử lại sau.',
  store: store15m,
});

const searchLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Quá nhiều tìm kiếm. Thử lại sau.',
  store: store15m,
});

module.exports = {
  loginLimiter,
  registerLimiter,
  passwordLimiter,
  bookingLimiter,
  paymentLimiter,
  searchLimiter,
};
