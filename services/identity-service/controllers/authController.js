'use strict';

const crypto = require('crypto');
const User = require('../models/User');
const PasswordResetToken = require('../models/PasswordResetToken');
const EmailVerificationToken = require('../models/EmailVerificationToken');
const UserSession = require('../models/Session');
const env = require('../config/env');
const outboxService = require('../services/outboxService');
const tokenService = require('../services/tokenService');
const totpService = require('../services/totpService');
const { hashPassword, verifyPassword } = require('../utils/password');
const { withTransaction } = require('../utils/mongoTransaction');
const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60_000;
const VERIFY_TOKEN_TTL_MS = 24 * 3600 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function isValidPassword(password) {
  // Min 10 chars; passphrases welcome, no forced character-class rules.
  return String(password || '').length >= 10;
}

function authCookieOptions() {
  return {
    path: '/',
    maxAge: SESSION_TTL_MS,
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
  };
}

function clearAuthCookie(res) {
  res.clearCookie(env.AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Peppered HMAC for password reset OTPs.
 *
 * A bare SHA-256 of a six-digit code is trivially reversible with a 10^6
 * rainbow table, so the server-side pepper is what makes a leaked token table
 * useless on its own.
 */
function hashResetOtp(otp) {
  return crypto
    .createHmac('sha256', env.PASSWORD_RESET_PEPPER)
    .update(String(otp).trim())
    .digest('hex');
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a || ''), 'hex');
  const bufB = Buffer.from(String(b || ''), 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function signToken(user, opts = {}) {
  return tokenService.signAccessToken(user, opts);
}

// —— Registration ——

const registerUser = asyncHandler(async (req, res) => {
  const { email, password, fullName, role, phone, hotline } = req.body;
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

  // Host onboarding needs business verification and a Catalog-owned profile,
  // neither of which identity owns yet. Until the M7 saga exists, host signup
  // stays on the monolith facade and identity refuses it outright.
  if (normalizedRole === 'host' && !env.IDENTITY_ALLOW_DIRECT_HOST_REGISTRATION) {
    const fromSaga = req.internalCaller === 'onboarding-saga';
    if (!fromSaga) {
      throw new ForbiddenError(
        'Đăng ký host phải đi qua luồng onboarding chính thức, không gọi trực tiếp Identity Service.'
      );
    }
  }

  const existingUser = await User.findOne({ Email: normalizedEmail }).lean();
  if (existingUser) throw new ValidationError('Email này đã được đăng ký!');

  const passwordHash = await hashPassword(password);

  const result = await withTransaction(async (session) => {
    const userDoc = {
      Email: normalizedEmail,
      PasswordHash: passwordHash,
      FullName: String(fullName).trim(),
      Role: normalizedRole,
      Status: 'inactive',
      EmailVerified: false,
      EmailVerifiedAt: null,
      AuthProvider: 'local',
      tokenVersion: 0,
    };

    let createdUser;
    try {
      if (session) {
        [createdUser] = await User.create([userDoc], { session });
      } else {
        createdUser = await User.create(userDoc);
      }
    } catch (err) {
      if (err.code === 11000) throw new ValidationError('Email này đã được đăng ký!');
      throw err;
    }

    let rawVerify = null;
    if (normalizedRole === 'customer') {
      rawVerify = crypto.randomBytes(32).toString('hex');
      const tokenDoc = {
        UserID: createdUser._id,
        TokenHash: sha256Hex(rawVerify),
        ExpiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      };
      if (session) await EmailVerificationToken.create([tokenDoc], { session });
      else await EmailVerificationToken.create(tokenDoc);

      await outboxService.enqueueEmail(
        {
          userId: createdUser._id,
          toEmail: createdUser.Email,
          template: 'verify_email',
          data: { token: rawVerify, fullName: createdUser.FullName },
          idempotencyKey: `register:${createdUser._id}:verify-email`,
        },
        { session }
      );
    }

    await outboxService.enqueueUserCreated(createdUser, { session });
    await outboxService.enqueueAudit(
      {
        userId: createdUser._id,
        action: 'REGISTER_USER',
        entityType: 'User',
        entityId: createdUser._id,
        message: `Tài khoản ${createdUser.FullName} vừa đăng ký mới trên hệ thống`,
        level: 'success',
        req,
      },
      { session }
    );

    return { user: createdUser, rawVerify };
  });

  const user = result.user;
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
  if (result.rawVerify && !env.isProduction) payload.devToken = result.rawVerify;
  return res.status(201).json(payload);
});

// —— Login ——

const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ValidationError('Email và mật khẩu là bắt buộc.');

  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ Email: normalizedEmail });

  // Uniform error — never reveal whether the address exists.
  if (!user) throw new UnauthorizedError('Tài khoản hoặc mật khẩu không chính xác.');
  if (user.Status === 'banned') {
    throw new ForbiddenError('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.');
  }
  if (user.Status !== 'active') {
    if (user.Role === 'host') {
      throw new ForbiddenError('Tài khoản host chưa được admin phê duyệt. Vui lòng chờ xác minh.');
    }
    if (user.AuthProvider === 'local' && !user.EmailVerified) {
      throw new ForbiddenError('Vui lòng xác minh email trước khi đăng nhập.');
    }
    throw new ForbiddenError('Tài khoản chưa được kích hoạt.');
  }
  if (user.AuthProvider !== 'google' && user.EmailVerified === false) {
    throw new ForbiddenError('Vui lòng xác minh email trước khi đăng nhập.');
  }

  const { ok, needsRehash } = await verifyPassword(password, user.PasswordHash);
  if (!ok) throw new UnauthorizedError('Tài khoản hoặc mật khẩu không chính xác.');

  if (needsRehash) {
    // Opportunistic bcrypt -> Argon2id upgrade. A failure here must not block
    // a login that already succeeded.
    try {
      const upgraded = await hashPassword(password);
      await User.updateOne({ _id: user._id }, { $set: { PasswordHash: upgraded } });
    } catch (err) {
      console.error('[Auth] Argon2id rehash failed:', err.message);
    }
  }

  if (user.TotpEnabled) {
    const { token: pendingToken } = await tokenService.issuePreAuthToken(user, {
      authMethod: 'password',
      req,
    });
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
 * The JWT carries the raw SID; the database stores only its hash.
 */
async function createAuthenticatedSession(req, res, user, {
  authMethod = 'password',
  redirect = null,
  json = true,
} = {}) {
  const sid = crypto.randomBytes(24).toString('base64url');
  const sidHash = sha256Hex(sid);
  const publicSessionId = crypto.randomBytes(16).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await withTransaction(async (session) => {
    const sessionDoc = {
      UserID: user._id,
      PublicSessionID: publicSessionId,
      SidHash: sidHash,
      Sid: '', // never store the raw SID
      TokenVersion: user.tokenVersion || 0,
      UserAgent: String(req.get('user-agent') || '').slice(0, 300),
      IP: String(req.ip || req.socket?.remoteAddress || '').slice(0, 64),
      AuthMethod: authMethod,
      LastSeenAt: new Date(),
      ExpiresAt: expiresAt,
    };
    if (session) await UserSession.create([sessionDoc], { session });
    else await UserSession.create(sessionDoc);

    await outboxService.enqueueSessionCreated(
      { user, sessionId: sidHash, publicSessionId, authMethod, expiresAt },
      { session }
    );
    await outboxService.enqueueAudit(
      {
        userId: user._id,
        action: 'LOGIN',
        entityType: 'User',
        entityId: user._id,
        message: `Tài khoản ${user.FullName || user.Email} vừa đăng nhập (${authMethod})`,
        level: 'info',
        req,
      },
      { session }
    );
  });

  const token = tokenService.signAccessToken(user, { sid });
  res.cookie(env.AUTH_COOKIE_NAME, token, authCookieOptions());

  if (redirect) return res.redirect(redirect);
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

// —— Two-factor ——

const verify2faLogin = asyncHandler(async (req, res) => {
  const code = req.body.code;
  const pendingToken = req.body.pendingToken || req.cookies?.preSession2fa || null;
  if (!pendingToken || !code) throw new ValidationError('Thiếu pendingToken hoặc mã 2FA.');

  let claims;
  try {
    claims = tokenService.verifyPreAuthToken(pendingToken);
  } catch {
    throw new UnauthorizedError('Phiên 2FA hết hạn hoặc không hợp lệ. Đăng nhập lại.');
  }

  const user = await User.findById(claims.userId).select(
    '+TotpSecret +TotpRecoveryHashes TotpEnabled tokenVersion Role Status Email FullName'
  );
  if (!user || !user.TotpEnabled) throw new UnauthorizedError('2FA chưa bật.');
  if (user.Status !== 'active') throw new ForbiddenError('Tài khoản chưa được kích hoạt.');

  // A password change between issuing and redeeming the token invalidates it.
  if (claims.tokenVersion !== (user.tokenVersion || 0)) {
    throw new UnauthorizedError('Phiên 2FA không còn hiệu lực. Đăng nhập lại.');
  }

  // Spend the one-time record before checking the code, so a wrong guess also
  // burns the token and cannot be retried with the same pendingToken.
  const consumed = await tokenService.consumePreAuthToken(claims.jti);
  if (!consumed.ok) {
    throw new UnauthorizedError('Phiên 2FA đã được sử dụng. Đăng nhập lại.');
  }

  // Fail closed: an undecryptable seed must never fall through to "valid".
  const decrypted = totpService.tryDecryptSecret(user.TotpSecret, user._id);
  let ok = decrypted.ok
    ? totpService.verifyTotp(decrypted.secret, code)
    : false;
  if (!decrypted.ok) {
    console.error(`[Auth] TOTP seed unreadable for user ${user._id}: ${decrypted.error}`);
  }

  if (!ok) {
    const recovery = await totpService.consumeRecoveryCodeAtomic(User, user._id, code);
    ok = recovery.ok;
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
  const user = await User.findById(req.user.userId).select('+TotpSecret TotpEnabled Email');
  if (!user) throw new NotFoundError('User not found');
  if (user.TotpEnabled) throw new ValidationError('2FA đã được bật.');

  const secret = totpService.generateSecret();
  user.TotpSecret = totpService.encryptSecret(secret, user._id);
  await user.save();

  res.json({
    secret,
    otpauthUrl: totpService.otpauthUrl({ secret, email: user.Email }),
    message: 'Quét QR/secret bằng app Authenticator, rồi gọi /api/auth/2fa/enable với mã.',
  });
});

const enable2fa = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const user = await User.findById(req.user.userId).select(
    '+TotpSecret +TotpRecoveryHashes TotpEnabled Email tokenVersion'
  );
  if (!user) throw new NotFoundError('User not found');
  if (!user.TotpSecret) throw new ValidationError('Gọi setup 2FA trước.');

  const decrypted = totpService.tryDecryptSecret(user.TotpSecret, user._id);
  if (!decrypted.ok || !totpService.verifyTotp(decrypted.secret, code)) {
    throw new ValidationError('Mã xác nhận không đúng.');
  }

  const recovery = totpService.generateRecoveryCodes(8);
  const hashes = await totpService.hashRecoveryCodes(recovery);

  await withTransaction(async (session) => {
    await User.updateOne(
      { _id: user._id },
      { $set: { TotpEnabled: true, TotpRecoveryHashes: hashes } },
      session ? { session } : {}
    );
    await outboxService.enqueueMfaChanged(user, true, { session });
    await outboxService.enqueueAudit(
      {
        userId: user._id,
        action: 'ENABLE_2FA',
        entityType: 'User',
        entityId: user._id,
        message: 'Bật TOTP 2FA',
        level: 'success',
        req,
      },
      { session }
    );
  });

  res.json({
    message: 'Đã bật 2FA.',
    recoveryCodes: recovery,
    warning: 'Lưu recovery codes ngay; chỉ hiện một lần.',
  });
});

const disable2fa = asyncHandler(async (req, res) => {
  const { code, password } = req.body;
  const user = await User.findById(req.user.userId).select(
    '+TotpSecret +TotpRecoveryHashes TotpEnabled PasswordHash tokenVersion'
  );
  if (!user) throw new NotFoundError('User not found');
  if (!user.TotpEnabled) throw new ValidationError('2FA chưa bật.');

  // Both factors required. This path previously ran bcrypt.compare against
  // Argon2id hashes, which rejected every correct password.
  const { ok: passOk } = await verifyPassword(password, user.PasswordHash);
  const decrypted = totpService.tryDecryptSecret(user.TotpSecret, user._id);
  const totpOk = decrypted.ok && totpService.verifyTotp(decrypted.secret, code);

  if (!passOk || !totpOk) throw new UnauthorizedError('Mật khẩu hoặc mã 2FA không đúng.');

  await withTransaction(async (session) => {
    await User.updateOne(
      { _id: user._id },
      { $set: { TotpEnabled: false, TotpSecret: null, TotpRecoveryHashes: [] } },
      session ? { session } : {}
    );
    await outboxService.enqueueMfaChanged(user, false, { session });
    await outboxService.enqueueAudit(
      {
        userId: user._id,
        action: 'DISABLE_2FA',
        entityType: 'User',
        entityId: user._id,
        message: 'Tắt TOTP 2FA',
        level: 'warning',
        req,
      },
      { session }
    );
  });

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

// —— Email verification ——

async function issueEmailVerifyToken(user, req) {
  const raw = crypto.randomBytes(32).toString('hex');

  await withTransaction(async (session) => {
    const opts = session ? { session } : {};
    await EmailVerificationToken.updateMany(
      { UserID: user._id, UsedAt: null },
      { $set: { UsedAt: new Date() } },
      opts
    );

    const tokenDoc = {
      UserID: user._id,
      TokenHash: sha256Hex(raw),
      ExpiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    };
    if (session) await EmailVerificationToken.create([tokenDoc], { session });
    else await EmailVerificationToken.create(tokenDoc);

    await outboxService.enqueueEmail(
      {
        userId: user._id,
        toEmail: user.Email,
        template: 'verify_email',
        data: { token: raw, fullName: user.FullName },
        idempotencyKey: `verify-email:${user._id}:${sha256Hex(raw).slice(0, 16)}`,
      },
      { session }
    );
    void req;
  });

  return raw;
}

const requestEmailVerification = asyncHandler(async (req, res) => {
  let user = null;
  if (req.user?.userId) {
    user = await User.findById(req.user.userId);
  } else if (req.body?.email) {
    user = await User.findOne({ Email: normalizeEmail(req.body.email) });
  }

  // Generic response — never reveal whether the address exists.
  const generic = { message: 'Nếu email hợp lệ, mã xác minh đã được gửi.' };
  if (!user || user.EmailVerified) return res.json(generic);

  const raw = await issueEmailVerifyToken(user, req);
  if (!env.isProduction) generic.devToken = raw;
  return res.json(generic);
});

const confirmEmailVerification = asyncHandler(async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!token) throw new ValidationError('Token không hợp lệ hoặc đã hết hạn.');

  const result = await withTransaction(async (session) => {
    const opts = session ? { session, new: true } : { new: true };
    const record = await EmailVerificationToken.findOneAndUpdate(
      { TokenHash: sha256Hex(token), UsedAt: null, ExpiresAt: { $gt: new Date() } },
      { $set: { UsedAt: new Date() } },
      opts
    );
    if (!record) throw new ValidationError('Token không hợp lệ hoặc đã hết hạn.');

    const userQuery = User.findById(record.UserID);
    if (session) userQuery.session(session);
    const user = await userQuery;
    if (!user) throw new NotFoundError('User not found');

    user.EmailVerified = true;
    user.EmailVerifiedAt = new Date();
    if (user.Role === 'customer' && user.Status === 'inactive') user.Status = 'active';
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save(session ? { session } : {});

    await outboxService.enqueueEmailVerified(user, { session });
    await outboxService.enqueueUserStatusChanged(user, { session });
    await outboxService.enqueueAudit(
      {
        userId: user._id,
        action: 'VERIFY_EMAIL',
        entityType: 'User',
        entityId: user._id,
        message: 'Xác minh email thành công',
        level: 'success',
        req,
      },
      { session }
    );

    return user;
  });

  void result;
  res.json({ message: 'Email đã xác minh.', verified: true });
});

// —— Session lifecycle ——

const logoutUser = asyncHandler(async (req, res) => {
  try {
    if (req.user?.sid) {
      const sidHash = sha256Hex(req.user.sid);
      const revoked = await UserSession.findOneAndUpdate(
        { SidHash: sidHash, RevokedAt: null },
        { $set: { RevokedAt: new Date() } },
        { new: true }
      );
      if (revoked) {
        await outboxService.enqueueSessionRevoked({
          userId: revoked.UserID,
          sessionId: sidHash,
          publicSessionId: revoked.PublicSessionID,
        });
      }
    }
  } catch (err) {
    // Best effort: never fail a logout because bookkeeping failed.
    console.error('[Auth] Session revoke during logout failed:', err.message);
  }

  clearAuthCookie(res);
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

// —— Password change / reset ——

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

  const { ok } = await verifyPassword(oldPassword, user.PasswordHash);
  if (!ok) throw new ValidationError('Mật khẩu cũ không chính xác!');

  const newHash = await hashPassword(newPassword);
  const nextTokenVersion = (user.tokenVersion || 0) + 1;

  await withTransaction(async (session) => {
    const opts = session ? { session } : {};
    await User.updateOne(
      { _id: user._id },
      { $set: { PasswordHash: newHash, tokenVersion: nextTokenVersion } },
      opts
    );
    await UserSession.updateMany(
      { UserID: user._id, RevokedAt: null },
      { $set: { RevokedAt: new Date() } },
      opts
    );
    await tokenService.revokePreAuthTokensForUser(user._id, { session });

    user.tokenVersion = nextTokenVersion;
    await outboxService.enqueuePasswordChanged(user, { session });
    await outboxService.enqueueAllSessionsRevoked(
      { userId: user._id, tokenVersion: nextTokenVersion },
      { session }
    );
    await outboxService.enqueueEmail(
      {
        userId: user._id,
        toEmail: user.Email,
        template: 'password_changed',
        data: { fullName: user.FullName },
        idempotencyKey: `password-changed:${user._id}:${nextTokenVersion}`,
      },
      { session }
    );
    await outboxService.enqueueAudit(
      {
        userId: user._id,
        action: 'CHANGE_PASSWORD',
        entityType: 'User',
        entityId: user._id,
        message: 'Đổi mật khẩu thành công',
        level: 'warning',
        req,
      },
      { session }
    );
  });

  clearAuthCookie(res);
  return res.status(200).json({ message: 'Cập nhật mật khẩu thành công! Vui lòng đăng nhập lại.' });
});

const GENERIC_FORGOT_MSG =
  'Nếu email tồn tại trên hệ thống, mã xác nhận đã được gửi. Vui lòng kiểm tra hộp thư.';

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ValidationError('Vui lòng nhập Email!');

  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ Email: normalizedEmail });

  // Identical response for unknown address, cooldown, and success.
  if (!user) return res.status(200).json({ message: GENERIC_FORGOT_MSG });

  const recent = await PasswordResetToken.findOne({
    Email: normalizedEmail,
    UsedAt: null,
    ExpiresAt: { $gt: new Date() },
    createdAt: { $gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS) },
  }).lean();
  if (recent) return res.status(200).json({ message: GENERIC_FORGOT_MSG });

  const otp = crypto.randomInt(100000, 1000000).toString();

  await withTransaction(async (session) => {
    const opts = session ? { session } : {};
    await PasswordResetToken.updateMany(
      { Email: normalizedEmail, UsedAt: null },
      { $set: { UsedAt: new Date() } },
      opts
    );

    const tokenDoc = {
      UserID: user._id,
      Email: normalizedEmail,
      TokenHash: hashResetOtp(otp),
      Attempts: 0,
      MaxAttempts: OTP_MAX_ATTEMPTS,
      ExpiresAt: new Date(Date.now() + OTP_TTL_MS),
    };
    if (session) await PasswordResetToken.create([tokenDoc], { session });
    else await PasswordResetToken.create(tokenDoc);

    // Enqueued in the same transaction — the OTP row and the delivery request
    // commit together, so there is no window where one exists without the other.
    await outboxService.enqueueEmail(
      {
        userId: user._id,
        toEmail: normalizedEmail,
        template: 'password_reset_otp',
        data: { otp, fullName: user.FullName },
        idempotencyKey: `password-reset:${user._id}:${hashResetOtp(otp).slice(0, 16)}`,
      },
      { session }
    );
  });

  const payload = { message: GENERIC_FORGOT_MSG };
  if (!env.isProduction) payload.devOtp = otp;
  return res.status(200).json(payload);
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
  const candidate = await PasswordResetToken.findOne({
    Email: normalizedEmail,
    UsedAt: null,
    ExpiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!candidate) throw new ValidationError('Mã xác nhận không hợp lệ hoặc đã hết hạn.');

  // Burn an attempt atomically before comparing, so parallel guesses cannot
  // share a single attempt slot.
  const attempted = await PasswordResetToken.findOneAndUpdate(
    {
      _id: candidate._id,
      UsedAt: null,
      ExpiresAt: { $gt: new Date() },
      $expr: { $lt: ['$Attempts', '$MaxAttempts'] },
    },
    { $inc: { Attempts: 1 } },
    { new: true }
  );
  if (!attempted) {
    throw new ValidationError('Đã vượt quá số lần thử. Vui lòng yêu cầu mã mới.');
  }

  if (!timingSafeEqualHex(hashResetOtp(otp), attempted.TokenHash)) {
    throw new ValidationError('Mã xác nhận không hợp lệ hoặc đã hết hạn.');
  }

  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (session) => {
    const opts = session ? { session } : {};

    // Consuming the token is the concurrency gate: whichever request flips
    // UsedAt first wins, the other aborts without touching the password.
    const consumed = await PasswordResetToken.findOneAndUpdate(
      { _id: attempted._id, UsedAt: null },
      { $set: { UsedAt: new Date() } },
      session ? { session, new: true } : { new: true }
    );
    if (!consumed) {
      throw new ValidationError('Mã xác nhận đã được sử dụng. Vui lòng yêu cầu mã mới.');
    }

    const userQuery = User.findById(consumed.UserID);
    if (session) userQuery.session(session);
    const user = await userQuery;
    if (!user) throw new NotFoundError('Tài khoản không tồn tại.');

    const nextTokenVersion = (user.tokenVersion || 0) + 1;
    await User.updateOne(
      { _id: user._id },
      { $set: { PasswordHash: passwordHash, tokenVersion: nextTokenVersion } },
      opts
    );
    await UserSession.updateMany(
      { UserID: user._id, RevokedAt: null },
      { $set: { RevokedAt: new Date() } },
      opts
    );
    await tokenService.revokePreAuthTokensForUser(user._id, { session });

    user.tokenVersion = nextTokenVersion;
    await outboxService.enqueuePasswordChanged(user, { session });
    await outboxService.enqueueAllSessionsRevoked(
      { userId: user._id, tokenVersion: nextTokenVersion },
      { session }
    );
    await outboxService.enqueueAudit(
      {
        userId: user._id,
        action: 'RESET_PASSWORD',
        entityType: 'User',
        entityId: user._id,
        message: 'Đặt lại mật khẩu qua email OTP',
        level: 'warning',
        req,
      },
      { session }
    );
  });

  clearAuthCookie(res);
  return res.status(200).json({ message: 'Đổi mật khẩu thành công! Vui lòng đăng nhập lại.' });
});

// —— WebAuthn / Passkey ——

const webauthnRegisterOptions = asyncHandler(async (req, res) => {
  const webauthnService = require('../services/webauthnService');
  const options = await webauthnService.registrationOptions({
    userId: req.user.userId,
    email: req.user.email,
    host: req.get('host'),
  });
  res.json({ options });
});

const webauthnRegisterVerify = asyncHandler(async (req, res) => {
  const webauthnService = require('../services/webauthnService');
  // Accept only the standard navigator.credentials.create() shape.
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
    const { token: pendingToken } = await tokenService.issuePreAuthToken(user, {
      authMethod: 'webauthn',
      req,
    });
    return res.json({ message: 'Cần xác thực 2FA.', requires2fa: true, pendingToken });
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
    const { token: pendingToken } = await tokenService.issuePreAuthToken(user, {
      authMethod: 'google',
      req,
    });
    // Never place a step-up token in a URL (history, logs, Referer).
    res.cookie('preSession2fa', pendingToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: tokenService.PREAUTH_MAX_AGE_SECONDS * 1000,
    });
    return res.redirect('/login?requires2fa=1');
  }

  return createAuthenticatedSession(req, res, user, {
    authMethod: 'google',
    redirect: '/',
    json: false,
  });
});

const googleMock = asyncHandler(async (req, res) => {
  const googleOidc = require('../services/googleOidcService');
  const user = await googleOidc.mockLogin({ email: req.body.email, name: req.body.name });
  return completeLogin(req, res, user, { authMethod: 'google' });
});

const googleStatus = asyncHandler(async (req, res) => {
  const googleOidc = require('../services/googleOidcService');
  res.json({ configured: googleOidc.configured(), mockAllowed: googleOidc.mockAllowed() });
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
  hashResetOtp,
};
