"use strict";

const rateLimit = require("express-rate-limit");

/**
 * Limiter state is process-wide and survives between tests, so an unrelated
 * suite can exhaust a budget and turn later assertions into spurious 429s.
 * Tests therefore run without limits unless they opt in explicitly, which is
 * what the rate-limit suite itself does.
 */
const SKIP_IN_TEST =
  process.env.NODE_ENV === "test" &&
  process.env.IDENTITY_ENABLE_RATE_LIMIT_IN_TEST !== "true";

function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    message: { error: message, code: "RATE_LIMITED" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => SKIP_IN_TEST,
  });
}

const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Quá nhiều lần thử đăng nhập/2FA. Vui lòng thử lại sau 15 phút.",
});

const registerLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Quá nhiều lần đăng ký. Vui lòng thử lại sau 1 giờ.",
});

const passwordLimiter = makeLimiter({
  windowMs: 30 * 60 * 1000,
  max: 5,
  message: "Quá nhiều yêu cầu đổi mật khẩu. Vui lòng thử lại sau 30 phút.",
});

const webauthnLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Quá nhiều yêu cầu WebAuthn. Vui lòng thử lại sau 15 phút.",
});

const emailVerifyLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Quá nhiều yêu cầu xác thực email. Vui lòng thử lại sau 15 phút.",
});

module.exports = {
  loginLimiter,
  registerLimiter,
  passwordLimiter,
  webauthnLimiter,
  emailVerifyLimiter,
};
