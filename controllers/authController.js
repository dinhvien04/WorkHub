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
  // Min 10 chars; allow passphrases (no forced complexity beyond length)
  return p.length >= 10;
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

function signToken(user, { sid } = {}) {
  const payload = {
    userId: user._id.toString(),
    role: user.Role,
    tokenVersion: user.tokenVersion || 0,
  };
  if (sid) payload.sid = String(sid);
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
    throw new ValidationError('Mật khẩu phải ít nhất 10 ký tự (hỗ trợ passphrase).');
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
  const initialStatus = 'inactive';
  const EmailVerificationToken = require('../models/EmailVerificationToken');
  const { withTransaction } = require('../utils/mongoTransaction');
  const outboxService = require('../services/outboxService');
  const { cleanupUploadedFile } = require('../utils/cloudinaryStorage');

  // Verification docs stay private — store path/public id only, never return raw
  const verificationDoc =
    req.file?.path || req.file?.filename || req.file?.public_id || 'uploaded';

  let devToken;
  let user;

  try {
    const result = await withTransaction(async (session) => {
      let createdUser;
      try {
        if (session) {
          [createdUser] = await User.create(
            [
              {
                Email: normalizedEmail,
                PasswordHash: passwordHash,
                FullName: String(fullName).trim(),
                Role: normalizedRole,
                Status: initialStatus,
                EmailVerified: false,
                EmailVerifiedAt: null,
                AuthProvider: 'local',
                tokenVersion: 0,
              },
            ],
            { session }
          );
        } else {
          createdUser = await User.create({
            Email: normalizedEmail,
            PasswordHash: passwordHash,
            FullName: String(fullName).trim(),
            Role: normalizedRole,
            Status: initialStatus,
            EmailVerified: false,
            EmailVerifiedAt: null,
            AuthProvider: 'local',
            tokenVersion: 0,
          });
        }
      } catch (err) {
        if (err.code === 11000) {
          throw new ValidationError('Email này đã được đăng ký!');
        }
        throw err;
      }

      if (normalizedRole === 'host') {
        const hostDoc = {
          UserID: createdUser._id,
          CompanyName: String(companyName).trim(),
          TaxCode: String(taxCode).trim(),
          VerificationDocument: verificationDoc,
          Logo: '',
          Hotline: String(contactPhone).trim(),
          IsVerified: false,
          BankName: String(bankName).trim(),
          BankNumber: String(bankNumber).trim(),
        };
        if (session) await HostProfile.create([hostDoc], { session });
        else await HostProfile.create(hostDoc);
      } else {
        const custDoc = {
          UserID: createdUser._id,
          Avatar: '',
          Phone: String(contactPhone).trim(),
          Description: '',
          JobTitle: '',
          Company: '',
          BankName: String(bankName || '').trim(),
          BankNumber: String(bankNumber || '').trim(),
        };
        if (session) await CustomerProfile.create([custDoc], { session });
        else await CustomerProfile.create(custDoc);
      }

      let rawVerify = null;
      if (normalizedRole === 'customer') {
        rawVerify = crypto.randomBytes(32).toString('hex');
        const TokenHash = crypto.createHash('sha256').update(rawVerify).digest('hex');
        const delQ = EmailVerificationToken.deleteMany({
          UserID: createdUser._id,
          UsedAt: null,
        });
        if (session) delQ.session(session);
        await delQ;
        const tokenDoc = {
          UserID: createdUser._id,
          TokenHash,
          ExpiresAt: new Date(Date.now() + 24 * 3600000),
        };
        if (session) await EmailVerificationToken.create([tokenDoc], { session });
        else await EmailVerificationToken.create(tokenDoc);

        // Raw token only encrypted short-lived — never plaintext in durable outbox
        await outboxService.enqueueSecureVerifyEmail(
          {
            to: createdUser.Email,
            userId: createdUser._id,
            rawToken: rawVerify,
            subject: 'Xác minh email WorkHub',
          },
          {
            session,
            idempotencyKey: `register:${createdUser._id}:verify-email`,
          }
        );
      }

      await outboxService.enqueueAudit(
        {
          userId: createdUser._id,
          action: 'REGISTER_USER',
          entityType: 'USER',
          entityId: createdUser._id,
          message: `Tài khoản ${createdUser.FullName} vừa đăng ký mới trên hệ thống`,
          level: 'success',
        },
        {
          session,
          idempotencyKey: `register:${createdUser._id}:audit`,
        }
      );

      return { user: createdUser, rawVerify };
    });

    user = result.user;
    if (result.rawVerify && !env.isProduction) devToken = result.rawVerify;
  } catch (err) {
    // Cleanup temporary upload if DB transaction failed
    if (req.file) {
      try {
        const upload = require('../middlewares/upload');
        await cleanupUploadedFile(upload.cloudinary, req.file);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }

  // Worker owns outbox delivery — do not processPending inline

  const payload = {
    message:
      normalizedRole === 'customer'
        ? 'Đăng ký thành công. Vui lòng xác minh email trước khi đăng nhập.'
        : 'Đăng ký host thành công. Chờ admin phê duyệt.',
    user: {
      id: user._id,
      email: user.Email,
      fullName: user.FullName,
      role: user.Role,
      status: user.Status,
      emailVerified: false,
    },
    requiresEmailVerification: normalizedRole === 'customer',
  };
  if (devToken) payload.devToken = devToken;
  return res.status(201).json(payload);
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
    if (user.AuthProvider === 'local' && !user.EmailVerified) {
      throw new ForbiddenError('Vui lòng xác minh email trước khi đăng nhập.');
    }
    throw new ForbiddenError('Tài khoản chưa được kích hoạt.');
  }
  // Active but email not verified (edge case) — still block local login
  if (user.AuthProvider !== 'google' && user.EmailVerified === false) {
    throw new ForbiddenError('Vui lòng xác minh email trước khi đăng nhập.');
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

/**
 * Canonical authenticated session for every login method.
 * JWT carries raw SID; DB stores only SidHash + PublicSessionID.
 */
async function createAuthenticatedSession(req, res, user, {
  authMethod = 'password',
  redirect = null,
  json = true,
} = {}) {
  const crypto = require('crypto');
  const UserSession = require('../models/Session');
  const sid = crypto.randomBytes(24).toString('base64url');
  const sidHash = crypto.createHash('sha256').update(sid).digest('hex');
  const publicSessionId = crypto.randomBytes(16).toString('base64url');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await UserSession.create({
    UserID: user._id,
    PublicSessionID: publicSessionId,
    SidHash: sidHash,
    // Never store raw SID
    Sid: '',
    TokenVersion: user.tokenVersion || 0,
    UserAgent: String(req.get('user-agent') || '').slice(0, 300),
    IP: String(req.ip || req.socket?.remoteAddress || '').slice(0, 64),
    AuthMethod: authMethod,
    LastSeenAt: new Date(),
    ExpiresAt: expiresAt,
  });

  const token = signToken(user, { sid });
  res.cookie(env.AUTH_COOKIE_NAME, token, authCookieOptions());

  await logActivity(
    user._id,
    'LOGIN',
    'User',
    user._id,
    `Tài khoản ${user.FullName || user.Email} vừa đăng nhập (${authMethod})`,
    'info'
  );

  if (redirect) {
    return res.redirect(redirect);
  }
  if (!json) return { token, publicSessionId, sid };
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

async function completeLogin(req, res, user, opts = {}) {
  return createAuthenticatedSession(req, res, user, {
    authMethod: opts.authMethod || 'password',
    redirect: opts.redirect || null,
    json: opts.json !== false,
  });
}

const verify2faLogin = asyncHandler(async (req, res) => {
  const code = req.body.code;
  // Prefer HttpOnly pre-session cookie; body token allowed for API clients
  const pendingToken =
    req.body.pendingToken ||
    req.cookies?.preSession2fa ||
    null;
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

  res.clearCookie('preSession2fa', {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
  return completeLogin(req, res, user, { authMethod: '2fa' });
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

async function issueEmailVerifyToken(user) {
  const EmailVerificationToken = require('../models/EmailVerificationToken');
  await EmailVerificationToken.updateMany(
    { UserID: user._id, UsedAt: null },
    { $set: { UsedAt: new Date() } }
  );
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
    /* optional */
  }
  return raw;
}

const requestEmailVerification = asyncHandler(async (req, res) => {
  // Auth path (active users re-verify) or public resend by email
  let user = null;
  if (req.user?.userId) {
    user = await User.findById(req.user.userId);
  } else if (req.body?.email) {
    user = await User.findOne({ Email: normalizeEmail(req.body.email) });
  }
  // Generic response — do not reveal whether email exists
  const generic = { message: 'Nếu email hợp lệ, mã xác minh đã được gửi.' };
  if (!user || user.EmailVerified) {
    return res.json(generic);
  }
  const raw = await issueEmailVerifyToken(user);
  if (!env.isProduction) generic.devToken = raw;
  res.json(generic);
});

const confirmEmailVerification = asyncHandler(async (req, res) => {
  const EmailVerificationToken = require('../models/EmailVerificationToken');
  const token = String(req.body.token || '').trim();
  if (!token) throw new ValidationError('Token không hợp lệ hoặc đã hết hạn.');
  const TokenHash = crypto.createHash('sha256').update(token).digest('hex');
  // Atomic consume
  const record = await EmailVerificationToken.findOneAndUpdate(
    {
      TokenHash,
      UsedAt: null,
      ExpiresAt: { $gt: new Date() },
    },
    { $set: { UsedAt: new Date() } },
    { new: true }
  );
  if (!record) throw new ValidationError('Token không hợp lệ hoặc đã hết hạn.');
  const user = await User.findById(record.UserID);
  if (!user) throw new NotFoundError('User not found');
  user.EmailVerified = true;
  user.EmailVerifiedAt = new Date();
  if (user.Role === 'customer' && user.Status === 'inactive') {
    user.Status = 'active';
  }
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
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
    throw new ValidationError('Mật khẩu mới phải ít nhất 10 ký tự.');
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
    // Never enumerate accounts via provider failure status codes.
    // Invalidate token so a failed enqueue cannot leave a usable secret.
    const logger = require('../utils/logger');
    logger.error('Password reset email delivery failed', err.message);
    await PasswordResetToken.updateMany(
      { Email: normalizedEmail, UsedAt: null, TokenHash: tokenHash },
      { $set: { UsedAt: new Date() } }
    );
  }

  // Identical response for nonexistent email, cooldown, and mail failure
  return res.status(200).json({ message: GENERIC_FORGOT_MSG });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    throw new ValidationError('Vui lòng điền đầy đủ tất cả các trường!');
  }
  if (!isValidPassword(newPassword)) {
    throw new ValidationError('Mật khẩu mới phải ít nhất 10 ký tự.');
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

  // Invalidate all sessions on password reset
  try {
    const UserSession = require('../models/Session');
    await UserSession.updateMany(
      { UserID: user._id, RevokedAt: null },
      { $set: { RevokedAt: new Date() } }
    );
  } catch {
    /* non-fatal */
  }

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

// —— WebAuthn / Passkey ——
const webauthnRegisterOptions = asyncHandler(async (req, res) => {
  const webauthnService = require('../services/webauthnService');
  const host = req.get('host');
  const options = await webauthnService.registrationOptions({
    userId: req.user.userId,
    email: req.user.email,
    host,
  });
  res.json({ options });
});

const webauthnRegisterVerify = asyncHandler(async (req, res) => {
  const webauthnService = require('../services/webauthnService');
  // Accept only standard navigator.credentials.create() shape — no publicKey fallback
  const credential =
    req.body.credential ||
    (req.body.response && (req.body.id || req.body.rawId)
      ? {
          id: req.body.id || req.body.rawId,
          rawId: req.body.rawId || req.body.id,
          type: req.body.type || 'public-key',
          response: req.body.response,
          clientExtensionResults: req.body.clientExtensionResults || {},
        }
      : null);
  const cred = await webauthnService.registerCredential({
    userId: req.user.userId,
    challenge: req.body.challenge,
    credential,
    deviceName: req.body.deviceName,
    strictRole: req.user.role === 'admin' || req.user.role === 'host',
  });
  res.status(201).json({
    message: 'Đã đăng ký passkey.',
    credential: { id: cred.CredentialId, deviceName: cred.DeviceName },
  });
});

const webauthnLoginOptions = asyncHandler(async (req, res) => {
  const webauthnService = require('../services/webauthnService');
  const options = await webauthnService.loginOptions({
    email: req.body.email,
    host: req.get('host'),
  });
  const { _userId, ...publicOpts } = options;
  res.json({ options: publicOpts });
});

const webauthnLoginVerify = asyncHandler(async (req, res) => {
  const webauthnService = require('../services/webauthnService');
  const user = await webauthnService.verifyLoginAssertion({
    challenge: req.body.challenge,
    credentialId: req.body.credentialId || req.body.id,
    signature: req.body.signature || req.body.response?.signature || '',
    clientDataJSON: req.body.clientDataJSON || req.body.response?.clientDataJSON,
    authenticatorData: req.body.authenticatorData || req.body.response?.authenticatorData,
    counter: req.body.counter,
    host: req.get('host'),
  });
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
    return res.json({
      message: 'Cần xác thực 2FA.',
      requires2fa: true,
      pendingToken,
    });
  }
  return completeLogin(req, res, user, { authMethod: 'webauthn' });
});

const webauthnList = asyncHandler(async (req, res) => {
  const webauthnService = require('../services/webauthnService');
  res.json({ credentials: await webauthnService.listCredentials(req.user.userId) });
});

const webauthnRevoke = asyncHandler(async (req, res) => {
  const webauthnService = require('../services/webauthnService');
  await webauthnService.revokeCredential(req.user.userId, req.params.credentialId);
  res.json({ message: 'Đã xóa passkey.' });
});

// —— Google OIDC ——
const googleStart = asyncHandler(async (req, res) => {
  const googleOidc = require('../services/googleOidcService');
  if (!googleOidc.configured()) {
    if (googleOidc.mockAllowed()) {
      return res.status(200).json({
        mock: true,
        message: 'Google chưa cấu hình — dùng POST /api/auth/google/mock trong dev/test.',
      });
    }
    throw new ValidationError('Google OIDC chưa được cấu hình trên server.');
  }
  const { url } = googleOidc.authorizationUrl(req, res);
  return res.redirect(302, url);
});

const googleCallback = asyncHandler(async (req, res) => {
  const googleOidc = require('../services/googleOidcService');
  const user = await googleOidc.handleCallback(req, res, {
    code: req.query.code,
    state: req.query.state,
  });
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
    // Never put 2FA token in URL (history/logs/Referer). HttpOnly pre-session cookie only.
    res.cookie('preSession2fa', pendingToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: 5 * 60 * 1000,
    });
    return res.redirect('/login?requires2fa=1');
  }
  // Canonical SID-bound session for Google (same as password/webauthn)
  return createAuthenticatedSession(req, res, user, {
    authMethod: 'google',
    redirect: '/',
    json: false,
  });
});

const googleMock = asyncHandler(async (req, res) => {
  const googleOidc = require('../services/googleOidcService');
  const user = await googleOidc.mockLogin({
    email: req.body.email,
    name: req.body.name,
  });
  return completeLogin(req, res, user, { authMethod: 'google' });
});

const googleStatus = asyncHandler(async (req, res) => {
  const googleOidc = require('../services/googleOidcService');
  res.json({
    configured: googleOidc.configured(),
    mockAllowed: googleOidc.mockAllowed(),
  });
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
  createAuthenticatedSession,
  completeLogin,
  authCookieOptions,
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
};
