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
router.post('/logout', logoutUser);
router.get('/me', authMiddleware.verifyToken, getMe);
router.post('/change-password', authMiddleware.verifyToken, changePassword);
router.post('/forgot-password', passwordLimiter, forgotPassword);
router.post('/reset-password', passwordLimiter, resetPassword);

module.exports = router;
