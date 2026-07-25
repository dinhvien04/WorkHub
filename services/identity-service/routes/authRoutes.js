"use strict";

const express = require("express");
const { verifyToken, optionalToken } = require("../middlewares/auth");
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

router.post("/register", registerLimiter, registerUser);
router.post("/login", loginLimiter, loginUser);
router.post("/2fa/verify", loginLimiter, verify2faLogin);
router.get("/2fa/status", verifyToken, get2faStatus);
router.post("/2fa/setup", verifyToken, setup2fa);
router.post("/2fa/enable", verifyToken, enable2fa);
router.post("/2fa/disable", verifyToken, disable2fa);

router.post("/email/request-verify", optionalToken, emailVerifyLimiter, requestEmailVerification);
router.post("/email/confirm", emailVerifyLimiter, confirmEmailVerification);

router.post("/webauthn/register/options", verifyToken, webauthnLimiter, webauthnRegisterOptions);
router.post("/webauthn/register/verify", verifyToken, webauthnLimiter, webauthnRegisterVerify);
router.post("/webauthn/login/options", webauthnLimiter, webauthnLoginOptions);
router.post("/webauthn/login/verify", webauthnLimiter, webauthnLoginVerify);
router.get("/webauthn/credentials", verifyToken, webauthnList);
router.delete(
  "/webauthn/credentials/:credentialId",
  verifyToken,
  webauthnRevoke,
);

router.get("/google", googleStart);
router.get("/google/callback", googleCallback);
router.get("/google/status", googleStatus);
router.post("/google/mock", loginLimiter, googleMock);

router.post("/logout", optionalToken, logoutUser);
router.get("/me", verifyToken, getMe);
router.post("/change-password", verifyToken, changePassword);
router.post("/forgot-password", passwordLimiter, forgotPassword);
router.post("/reset-password", passwordLimiter, resetPassword);

module.exports = router;
