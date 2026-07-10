'use strict';

const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test';

function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max: isTest ? 10000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message, code: 'RATE_LIMITED' },
  });
}

const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Quá nhiều lần đăng nhập. Vui lòng thử lại sau.',
});

const registerLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Quá nhiều lần đăng ký. Vui lòng thử lại sau.',
});

const passwordLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau.',
});

const bookingLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Quá nhiều yêu cầu đặt chỗ. Vui lòng thử lại sau.',
});

const paymentLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Quá nhiều yêu cầu thanh toán. Vui lòng thử lại sau.',
});

module.exports = {
  loginLimiter,
  registerLimiter,
  passwordLimiter,
  bookingLimiter,
  paymentLimiter,
};
