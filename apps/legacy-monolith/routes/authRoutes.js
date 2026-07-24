'use strict';

const express = require('express');
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
} = require('../controllers/authController');

const authMiddleware = require('../middlewares/authMiddleware');
const upload = require('../middlewares/upload');
const {
  loginLimiter,
  registerLimiter,
  passwordLimiter,
  webauthnLimiter,
  emailVerifyLimiter,
} = require('../middlewares/rateLimiters');
const { ensureCsrfCookie } = require('../middlewares/csrfMiddleware');

const router = express.Router();

router.get('/csrf', ensureCsrfCookie, (req, res) => {
  res.json({ csrfToken: res.locals.csrfToken || (req.cookies && req.cookies.csrfToken) });
});

router.post(
  '/register',
  registerLimiter,
  ...(upload.singleWithMagic
    ? upload.singleWithMagic('verificationDocument')
    : [upload.single('verificationDocument')]),
  registerUser
);
router.post('/login', loginLimiter, loginUser);
router.post('/2fa/verify', loginLimiter, verify2faLogin);
router.get('/2fa/status', authMiddleware.verifyToken, get2faStatus);
router.post('/2fa/setup', authMiddleware.verifyToken, setup2fa);
router.post('/2fa/enable', authMiddleware.verifyToken, enable2fa);
router.post('/2fa/disable', authMiddleware.verifyToken, disable2fa);
router.post('/email/request-verify', authMiddleware.verifyToken, emailVerifyLimiter, requestEmailVerification);
router.post('/email/confirm', emailVerifyLimiter, confirmEmailVerification);
// Passkey / WebAuthn
router.post('/webauthn/register/options', authMiddleware.verifyToken, webauthnLimiter, webauthnRegisterOptions);
router.post('/webauthn/register/verify', authMiddleware.verifyToken, webauthnLimiter, webauthnRegisterVerify);
router.post('/webauthn/login/options', webauthnLimiter, webauthnLoginOptions);
router.post('/webauthn/login/verify', webauthnLimiter, webauthnLoginVerify);
router.get('/webauthn/credentials', authMiddleware.verifyToken, webauthnList);
router.delete('/webauthn/credentials/:credentialId', authMiddleware.verifyToken, webauthnRevoke);
// Google OIDC
router.get('/google', googleStart);
router.get('/google/callback', googleCallback);
router.get('/google/status', googleStatus);
router.post('/google/mock', loginLimiter, googleMock);
router.post('/logout', logoutUser);
router.get('/me', authMiddleware.verifyToken, getMe);
router.post('/change-password', authMiddleware.verifyToken, changePassword);
router.post('/forgot-password', passwordLimiter, forgotPassword);
router.post('/reset-password', passwordLimiter, resetPassword);

module.exports = router;
