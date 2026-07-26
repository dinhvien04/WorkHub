"use strict";

const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { ensureCsrfCookie } = require("../middlewares/csrf");
const {
  loginLimiter,
  registerLimiter,
  passwordLimiter,
  webauthnLimiter,
  emailVerifyLimiter,
} = require("../middlewares/rateLimiters");
const {
  registerUser,
  loginUser,
  logoutUser,
  changePassword,
  forgotPassword,
  resetPassword,
  getMe,
  verify2faLogin,
  setup2fa,
  enable2fa,
  disable2fa,
  get2faStatus,
  requestEmailVerification,
  confirmEmailVerification,
  webauthnRegisterOptions,
  webauthnRegisterVerify,
  webauthnLoginOptions,
  webauthnLoginVerify,
  webauthnList,
  webauthnRevoke,
  googleStart,
  googleCallback,
  googleMock,
  googleStatus,
} = require("../controllers/authController");

const router = express.Router();

/**
 * Hand the SPA a CSRF token. Matches the monolith contract so clients do not
 * have to know which service answered.
 */
router.get("/csrf", ensureCsrfCookie, (req, res) => {
  res.json({ csrfToken: res.locals.csrfToken });
});

router.post("/register", registerLimiter, registerUser);
router.post("/login", loginLimiter, loginUser);
router.post("/2fa/verify", loginLimiter, verify2faLogin);

router.get("/2fa/status", requireAuth, get2faStatus);
router.post("/2fa/setup", requireAuth, setup2fa);
router.post("/2fa/enable", requireAuth, enable2fa);
router.post("/2fa/disable", requireAuth, disable2fa);

router.post("/email/request-verify", emailVerifyLimiter, requestEmailVerification);
router.post("/email/confirm", emailVerifyLimiter, confirmEmailVerification);

router.post("/webauthn/register/options", requireAuth, webauthnLimiter, webauthnRegisterOptions);
router.post("/webauthn/register/verify", requireAuth, webauthnLimiter, webauthnRegisterVerify);
router.post("/webauthn/login/options", webauthnLimiter, webauthnLoginOptions);
router.post("/webauthn/login/verify", webauthnLimiter, webauthnLoginVerify);
router.get("/webauthn/credentials", requireAuth, webauthnList);
router.delete("/webauthn/credentials/:credentialId", requireAuth, webauthnRevoke);

router.get("/google", googleStart);
router.get("/google/callback", googleCallback);
router.get("/google/status", googleStatus);
router.post("/google/mock", loginLimiter, googleMock);

router.post("/logout", logoutUser);
router.get("/me", requireAuth, getMe);
router.post("/change-password", requireAuth, changePassword);
router.post("/forgot-password", passwordLimiter, forgotPassword);
router.post("/reset-password", passwordLimiter, resetPassword);

module.exports = router;
