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

  const user = await User.create({
    Email: normalizedEmail,
    PasswordHash: passwordHash,
    FullName: String(fullName).trim(),
    Role: normalizedRole,
    Status: 'active',
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
    throw new ForbiddenError('Tài khoản chưa được kích hoạt.');
  }

  const isMatch = await bcrypt.compare(String(password), user.PasswordHash);
  if (!isMatch) throw new UnauthorizedError('Tài khoản hoặc mật khẩu không chính xác.');

  const token = signToken(user);

  res.cookie(env.AUTH_COOKIE_NAME, token, authCookieOptions());

  await logActivity(
    user._id,
    'LOGIN',
    'User',
    user._id,
    `Tài khoản ${user.FullName || user.Email} vừa đăng nhập hệ thống`,
    'info'
  );

  // Do NOT return token in JSON body (HttpOnly cookie only)
  return res.status(200).json({
    message: 'Đăng nhập thành công.',
    user: {
      id: user._id,
      email: user.Email,
      fullName: user.FullName,
      role: user.Role,
      status: user.Status,
    },
  });
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

  await emailService.sendPasswordResetOtp({ to: normalizedEmail, otp });

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
};
