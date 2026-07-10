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
} = require('../controllers/authController');

const authMiddleware = require('../middlewares/authMiddleware');
const upload = require('../middlewares/upload');
const {
  loginLimiter,
  registerLimiter,
  passwordLimiter,
} = require('../middlewares/rateLimiters');
const { ensureCsrfCookie } = require('../middlewares/csrfMiddleware');

const router = express.Router();

router.get('/csrf', ensureCsrfCookie, (req, res) => {
  res.json({ csrfToken: res.locals.csrfToken || (req.cookies && req.cookies.csrfToken) });
});

router.post('/register', registerLimiter, upload.single('verificationDocument'), registerUser);
router.post('/login', loginLimiter, loginUser);
router.post('/2fa/verify', loginLimiter, verify2faLogin);
router.get('/2fa/status', authMiddleware.verifyToken, get2faStatus);
router.post('/2fa/setup', authMiddleware.verifyToken, setup2fa);
router.post('/2fa/enable', authMiddleware.verifyToken, enable2fa);
router.post('/2fa/disable', authMiddleware.verifyToken, disable2fa);
router.post('/email/request-verify', authMiddleware.verifyToken, requestEmailVerification);
router.post('/email/confirm', confirmEmailVerification);
router.post('/logout', logoutUser);
router.get('/me', authMiddleware.verifyToken, getMe);
router.post('/change-password', authMiddleware.verifyToken, changePassword);
router.post('/forgot-password', passwordLimiter, forgotPassword);
router.post('/reset-password', passwordLimiter, resetPassword);

module.exports = router;
