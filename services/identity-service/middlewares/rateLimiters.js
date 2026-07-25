"use strict";

const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Quá nhiều lần thử đăng nhập/2FA. Vui lòng thử lại sau 15 phút." },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Quá nhiều lần đăng ký. Vui lòng thử lại sau 1 giờ." },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  message: { error: "Quá nhiều yêu cầu đổi mật khẩu. Vui lòng thử lại sau 30 phút." },
  standardHeaders: true,
  legacyHeaders: false,
});

const webauthnLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Quá nhiều yêu cầu WebAuthn. Vui lòng thử lại sau 15 phút." },
  standardHeaders: true,
  legacyHeaders: false,
});

const emailVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Quá nhiều yêu cầu xác thực email. Vui lòng thử lại sau 15 phút." },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  loginLimiter,
  registerLimiter,
  passwordLimiter,
  webauthnLimiter,
  emailVerifyLimiter,
};
