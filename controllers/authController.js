'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const CustomerProfile = require('../models/Customer_Profile');
const HostProfile = require('../models/Host_Profile');
const PasswordResetToken = require('../models/PasswordResetToken');
const logActivity = require('../utils/auditLogger');
const emailService = require('../services/emailService');
const env = require('../config/env');
const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function isValidPassword(password) {
  const p = String(password || '');
  return p.length >= 6 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

function authCookieOptions() {
  return {
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
  };
}

function signToken(user) {
  const payload = {
    userId: user._id.toString(),
    role: user.Role,
    tokenVersion: user.tokenVersion || 0,
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

const registerUser = asyncHandler(async (req, res) => {
  const { email, password, fullName, role, companyName, taxCode, phone, hotline, bankName, bankNumber } = req.body;
  const contactPhone = phone || hotline;

  if (!email || !password || !fullName || !contactPhone) {
    throw new ValidationError('Vui lòng nhập đầy đủ Email, Mật khẩu, Họ tên và Số điện thoại!');
  }
  if (!isValidEmail(email)) throw new ValidationError('Định dạng email không hợp lệ!');
  if (!isValidPassword(password)) {
    throw new ValidationError('Mật khẩu phải >= 6 ký tự, bao gồm cả chữ và số!');
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!['customer', 'host'].includes(normalizedRole)) {
    throw new ValidationError('Role không hợp lệ.');
  }

  if (normalizedRole === 'host') {
    if (!companyName || !taxCode || !bankName || !bankNumber) {
      throw new ValidationError('Host bắt buộc nhập Tên công ty, Mã số thuế và Thông tin ngân hàng!');
    }
    if (!req.file) throw new ValidationError('Vui lòng tải lên Giấy phép kinh doanh!');
  }

  const existingUser = await User.findOne({ Email: normalizedEmail });
  if (existingUser) throw new ValidationError('Email này đã được đăng ký!');

  const passwordHash = await bcrypt.hash(String(password), 10);

  // Host starts inactive until admin verifies; customers active immediately
  const initialStatus = normalizedRole === 'host' ? 'inactive' : 'active';

  const user = await User.create({
    Email: normalizedEmail,
    PasswordHash: passwordHash,
    FullName: String(fullName).trim(),
    Role: normalizedRole,
    Status: initialStatus,
    tokenVersion: 0,
  });

  if (normalizedRole === 'host') {
    await HostProfile.create({
      UserID: user._id,
      CompanyName: String(companyName).trim(),
      TaxCode: String(taxCode).trim(),
      VerificationDocument: req.file?.path || req.file?.filename || 'uploaded',
      Logo: '',
      Hotline: String(contactPhone).trim(),
      IsVerified: false,
      BankName: String(bankName).trim(),
      BankNumber: String(bankNumber).trim(),
    });
  } else {
    await CustomerProfile.create({
      UserID: user._id,
      Avatar: '',
      Phone: String(contactPhone).trim(),
      Description: '',
      JobTitle: '',
      Company: '',
      BankName: String(bankName || '').trim(),
      BankNumber: String(bankNumber || '').trim(),
    });
  }

  await logActivity(
    user._id,
    'REGISTER_USER',
    'USER',
    user._id,
    `Tài khoản ${user.FullName} vừa đăng ký mới trên hệ thống`,
    'success'
  );

  return res.status(201).json({
    message: 'Đăng ký thành công.',
    user: {
      id: user._id,
      email: user.Email,
      fullName: user.FullName,
      role: user.Role,
      status: user.Status,
    },
  });
});

const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ValidationError('Email và mật khẩu là bắt buộc.');

  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ Email: normalizedEmail });

  // Uniform error — do not reveal whether email exists
  if (!user) throw new UnauthorizedError('Tài khoản hoặc mật khẩu không chính xác.');
  if (user.Status === 'banned') {
    throw new ForbiddenError('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.');
  }
  if (user.Status !== 'active') {
    if (user.Role === 'host') {
      throw new ForbiddenError(
        'Tài khoản host chưa được admin phê duyệt. Vui lòng chờ xác minh.'
      );
    }
    throw new ForbiddenError('Tài khoản chưa được kích hoạt.');
  }

  const isMatch = await bcrypt.compare(String(password), user.PasswordHash);
  if (!isMatch) throw new UnauthorizedError('Tài khoản hoặc mật khẩu không chính xác.');

  // Step-up: if TOTP enabled, issue short-lived pending token (no auth cookie yet)
  if (user.TotpEnabled) {
    const pendingToken = jwt.sign(
      {
        userId: user._id.toString(),
        purpose: '2fa',
        tokenVersion: user.tokenVersion || 0,
      },
      env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    return res.status(200).json({
      message: 'Cần xác thực 2FA.',
      requires2fa: true,
      pendingToken,
    });
  }

  return completeLogin(req, res, user);
});

async function completeLogin(req, res, user) {
  const token = signToken(user);
  res.cookie(env.AUTH_COOKIE_NAME, token, authCookieOptions());

  try {
    const UserSession = require('../models/Session');
    await UserSession.create({
      UserID: user._id,
      TokenVersion: user.tokenVersion || 0,
      UserAgent: String(req.get('user-agent') || '').slice(0, 300),
      IP: String(req.ip || req.socket?.remoteAddress || '').slice(0, 64),
      LastSeenAt: new Date(),
    });
  } catch {
    /* non-blocking */
  }

  await logActivity(
    user._id,
    'LOGIN',
    'User',
    user._id,
    `Tài khoản ${user.FullName || user.Email} vừa đăng nhập hệ thống`,
    'info'
  );

  return res.status(200).json({
    message: 'Đăng nhập thành công.',
    requires2fa: false,
    user: {
      id: user._id,
      email: user.Email,
      fullName: user.FullName,
      role: user.Role,
      status: user.Status,
      totpEnabled: !!user.TotpEnabled,
    },
  });
}

const verify2faLogin = asyncHandler(async (req, res) => {
  const { pendingToken, code } = req.body;
  if (!pendingToken || !code) throw new ValidationError('Thiếu pendingToken hoặc mã 2FA.');

  let decoded;
  try {
    decoded = jwt.verify(pendingToken, env.JWT_SECRET);
  } catch {
    throw new UnauthorizedError('Phiên 2FA hết hạn. Đăng nhập lại.');
  }
  if (decoded.purpose !== '2fa') throw new UnauthorizedError('Token 2FA không hợp lệ.');

  const totpService = require('../services/totpService');
  const user = await User.findById(decoded.userId).select(
    '+TotpSecret +TotpRecoveryHashes TotpEnabled tokenVersion Role Status Email FullName'
  );
  if (!user || !user.TotpEnabled) throw new UnauthorizedError('2FA chưa bật.');
  if (user.Status !== 'active') throw new ForbiddenError('Tài khoản chưa được kích hoạt.');

  let ok = totpService.verifyTotp(user.TotpSecret, code);
  if (!ok) {
    const consumed = await totpService.consumeRecoveryCode(user.TotpRecoveryHashes, code);
    if (consumed.ok) {
      user.TotpRecoveryHashes = consumed.remaining;
      await user.save();
      ok = true;
    }
  }
  if (!ok) throw new UnauthorizedError('Mã 2FA không đúng.');

  return completeLogin(req, res, user);
});

const setup2fa = asyncHandler(async (req, res) => {
  const totpService = require('../services/totpService');
  const user = await User.findById(req.user.userId).select('+TotpSecret TotpEnabled Email');
  if (!user) throw new NotFoundError('User not found');
  if (user.TotpEnabled) throw new ValidationError('2FA đã được bật.');

  const secret = totpService.generateSecret();
  user.TotpSecret = secret;
  await user.save();

  res.json({
    secret,
    otpauthUrl: totpService.otpauthUrl({ secret, email: user.Email }),
    message: 'Quét QR/secret bằng app Authenticator, rồi gọi /api/auth/2fa/enable với mã.',
  });
});

const enable2fa = asyncHandler(async (req, res) => {
  const totpService = require('../services/totpService');
  const { code } = req.body;
  const user = await User.findById(req.user.userId).select(
    '+TotpSecret +TotpRecoveryHashes TotpEnabled Email'
  );
  if (!user) throw new NotFoundError('User not found');
  if (!user.TotpSecret) throw new ValidationError('Gọi setup 2FA trước.');
  if (!totpService.verifyTotp(user.TotpSecret, code)) {
    throw new ValidationError('Mã xác nhận không đúng.');
  }

  const recovery = totpService.generateRecoveryCodes(8);
  user.TotpRecoveryHashes = await totpService.hashRecoveryCodes(recovery);
  user.TotpEnabled = true;
  await user.save();

  await logActivity(user._id, 'ENABLE_2FA', 'User', user._id, 'Bật TOTP 2FA', 'success');

  res.json({
    message: 'Đã bật 2FA.',
    recoveryCodes: recovery,
    warning: 'Lưu recovery codes ngay; chỉ hiện một lần.',
  });
});

const disable2fa = asyncHandler(async (req, res) => {
  const totpService = require('../services/totpService');
  const { code, password } = req.body;
  const user = await User.findById(req.user.userId).select(
    '+TotpSecret +TotpRecoveryHashes TotpEnabled PasswordHash'
  );
  if (!user) throw new NotFoundError('User not found');
  if (!user.TotpEnabled) throw new ValidationError('2FA chưa bật.');

  const passOk = password && (await bcrypt.compare(String(password), user.PasswordHash));
  const totpOk = totpService.verifyTotp(user.TotpSecret, code);
  if (!passOk || !totpOk) throw new UnauthorizedError('Mật khẩu hoặc mã 2FA không đúng.');

  user.TotpEnabled = false;
  user.TotpSecret = null;
  user.TotpRecoveryHashes = [];
  await user.save();
  await logActivity(user._id, 'DISABLE_2FA', 'User', user._id, 'Tắt TOTP 2FA', 'warning');
  res.json({ message: 'Đã tắt 2FA.' });
});

const get2faStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId).select('TotpEnabled Role');
  res.json({
    totpEnabled: !!user?.TotpEnabled,
    recommended: user?.Role === 'admin' || user?.Role === 'host',
    requiredForAdmin: false,
  });
});

const requestEmailVerification = asyncHandler(async (req, res) => {
  const EmailVerificationToken = require('../models/EmailVerificationToken');
  const user = await User.findById(req.user.userId);
  if (!user) throw new NotFoundError('User not found');
  if (user.EmailVerified) {
    return res.json({ message: 'Email đã được xác minh.', verified: true });
  }
  const raw = crypto.randomBytes(32).toString('hex');
  const TokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  await EmailVerificationToken.create({
    UserID: user._id,
    TokenHash,
    ExpiresAt: new Date(Date.now() + 24 * 3600000),
  });
  try {
    await emailService.sendGeneric({
      to: user.Email,
      subject: 'Xác minh email WorkHub',
      text: `Mã xác minh email WorkHub: ${raw}\nHết hạn sau 24 giờ.`,
    });
  } catch {
    /* dev: token still returned only in non-production */
  }
  const payload = { message: 'Đã gửi mã xác minh (nếu email provider cấu hình).' };
  if (!env.isProduction) payload.devToken = raw;
  res.json(payload);
});

const confirmEmailVerification = asyncHandler(async (req, res) => {
  const EmailVerificationToken = require('../models/EmailVerificationToken');
  const token = String(req.body.token || '').trim();
  if (!token) throw new ValidationError('Thiếu token.');
  const TokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await EmailVerificationToken.findOne({
    TokenHash,
    UsedAt: null,
    ExpiresAt: { $gt: new Date() },
  });
  if (!record) throw new ValidationError('Token không hợp lệ hoặc đã hết hạn.');
  const user = await User.findById(record.UserID);
  if (!user) throw new NotFoundError('User not found');
  user.EmailVerified = true;
  user.EmailVerifiedAt = new Date();
  await user.save();
  record.UsedAt = new Date();
  await record.save();
  res.json({ message: 'Email đã xác minh.', verified: true });
});

const logoutUser = asyncHandler(async (req, res) => {
  res.clearCookie(env.AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
  return res.json({ message: 'Đăng xuất thành công.' });
});

const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId).select('-PasswordHash').lean();
  if (!user) throw new NotFoundError('Người dùng không tồn tại.');
  return res.json({
    user: {
      id: user._id,
      email: user.Email,
      fullName: user.FullName,
      role: user.Role,
      status: user.Status,
    },
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.user?.userId;
  if (!userId) throw new UnauthorizedError('Phiên làm việc hết hạn, vui lòng đăng nhập lại!');
  if (!oldPassword || !newPassword) {
    throw new ValidationError('Vui lòng nhập đầy đủ mật khẩu cũ và mật khẩu mới!');
  }
  if (!isValidPassword(newPassword)) {
    throw new ValidationError('Mật khẩu mới phải >= 6 ký tự, bao gồm cả chữ và số!');
  }

  const user = await User.findById(userId);
  if (!user) throw new NotFoundError('Tài khoản không tồn tại trên hệ thống!');

  const isMatch = await bcrypt.compare(String(oldPassword), user.PasswordHash);
  if (!isMatch) throw new ValidationError('Mật khẩu cũ không chính xác!');

  const newPasswordHash = await bcrypt.hash(String(newPassword), 10);
  user.PasswordHash = newPasswordHash;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  // Invalidate current session cookie — client must re-login
  res.clearCookie(env.AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });

  return res.status(200).json({ message: 'Cập nhật mật khẩu thành công! Vui lòng đăng nhập lại.' });
});

const GENERIC_FORGOT_MSG =
  'Nếu email tồn tại trên hệ thống, mã xác nhận đã được gửi. Vui lòng kiểm tra hộp thư.';

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ValidationError('Vui lòng nhập Email!');

  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ Email: normalizedEmail });

  // Always same response (no email enumeration)
  if (!user) {
    return res.status(200).json({ message: GENERIC_FORGOT_MSG });
  }

  // Resend cooldown: reject if a non-expired token was created in last 60s
  const recent = await PasswordResetToken.findOne({
    Email: normalizedEmail,
    UsedAt: null,
    ExpiresAt: { $gt: new Date() },
    createdAt: { $gt: new Date(Date.now() - 60_000) },
  });
  if (recent) {
    return res.status(200).json({ message: GENERIC_FORGOT_MSG });
  }

  // Invalidate previous unused tokens
  await PasswordResetToken.updateMany(
    { Email: normalizedEmail, UsedAt: null },
    { $set: { UsedAt: new Date() } }
  );

  const otp = crypto.randomInt(100000, 1000000).toString();
  const tokenHash = crypto.createHash('sha256').update(otp).digest('hex');

  await PasswordResetToken.create({
    UserID: user._id,
    Email: normalizedEmail,
    TokenHash: tokenHash,
    Attempts: 0,
    MaxAttempts: 5,
    ExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  try {
    await emailService.sendPasswordResetOtp({ to: normalizedEmail, otp });
  } catch (err) {
    // Never log OTP. Generic client message; production fail is operational.
    const logger = require('../utils/logger');
    logger.error('Password reset email delivery failed', err.message);
    if (env.isProduction) {
      return res.status(503).json({
        message: 'Không thể xử lý yêu cầu lúc này. Vui lòng thử lại sau.',
      });
    }
    // Dev still returns generic success (outbox path is primary)
  }

  return res.status(200).json({ message: GENERIC_FORGOT_MSG });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    throw new ValidationError('Vui lòng điền đầy đủ tất cả các trường!');
  }
  if (!isValidPassword(newPassword)) {
    throw new ValidationError('Mật khẩu mới phải >= 6 ký tự, bao gồm cả chữ và số!');
  }

  const normalizedEmail = normalizeEmail(email);
  const record = await PasswordResetToken.findOne({
    Email: normalizedEmail,
    UsedAt: null,
    ExpiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!record) {
    throw new ValidationError('Mã xác nhận không hợp lệ hoặc đã hết hạn.');
  }
  if (record.Attempts >= record.MaxAttempts) {
    throw new ValidationError('Đã vượt quá số lần thử. Vui lòng yêu cầu mã mới.');
  }

  const tokenHash = crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
  if (tokenHash !== record.TokenHash) {
    record.Attempts += 1;
    await record.save();
    throw new ValidationError('Mã xác nhận không hợp lệ hoặc đã hết hạn.');
  }

  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  const user = await User.findById(record.UserID);
  if (!user) throw new NotFoundError('Tài khoản không tồn tại.');

  user.PasswordHash = passwordHash;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  record.UsedAt = new Date();
  await record.save();

  res.clearCookie(env.AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });

  return res.status(200).json({ message: 'Đổi mật khẩu thành công! Vui lòng đăng nhập lại.' });
});

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  getMe,
  changePassword,
  forgotPassword,
  resetPassword,
  signToken,
  authCookieOptions,
  verify2faLogin,
  setup2fa,
  enable2fa,
  disable2fa,
  get2faStatus,
  requestEmailVerification,
  confirmEmailVerification,
};
