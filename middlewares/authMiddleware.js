'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const HostProfile = require('../models/Host_Profile');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, cookieString) => {
    const [name, ...rest] = cookieString.trim().split('=');
    if (!name) return cookies;
    cookies[name] = decodeURIComponent(rest.join('='));
    return cookies;
  }, {});
}

function extractToken(req) {
  const authHeader = req.header('Authorization') || req.headers.authorization;
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
    return authHeader.trim();
  }
  const cookies = req.cookies || parseCookies(req.headers.cookie || '');
  return cookies[env.AUTH_COOKIE_NAME] || cookies.authToken || null;
}

/**
 * Verify JWT, reload user from DB, enforce active status + tokenVersion.
 * Sets req.user = { userId, role, status, tokenVersion, email, fullName }
 */
async function verifyToken(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return next(new UnauthorizedError('Không tìm thấy token xác thực. Vui lòng đăng nhập.'));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return next(new UnauthorizedError('Token đã hết hạn. Vui lòng đăng nhập lại.'));
      }
      return next(new UnauthorizedError('Token không hợp lệ.'));
    }

    const userId = decoded.userId || decoded.id || decoded._id;
    if (!userId) {
      return next(new UnauthorizedError('Token không chứa userId.'));
    }

    const user = await User.findById(userId).select('_id Role Status Email FullName tokenVersion');
    if (!user) {
      return next(new UnauthorizedError('Tài khoản không tồn tại.'));
    }
    if (user.Status === 'banned') {
      return next(new ForbiddenError('Tài khoản của bạn đã bị khóa.'));
    }
    if (user.Status !== 'active') {
      return next(new ForbiddenError('Tài khoản chưa được kích hoạt.'));
    }

    const tokenVersion = typeof decoded.tokenVersion === 'number' ? decoded.tokenVersion : 0;
    const dbVersion = typeof user.tokenVersion === 'number' ? user.tokenVersion : 0;
    if (tokenVersion !== dbVersion) {
      return next(new UnauthorizedError('Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.'));
    }

    req.user = {
      userId: user._id.toString(),
      role: user.Role,
      status: user.Status,
      tokenVersion: dbVersion,
      email: user.Email,
      fullName: user.FullName,
    };
    req.currentUser = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Optional auth: attach user if token present, otherwise continue as guest.
 */
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();
  return verifyToken(req, res, next);
}

const authorizeRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) return next(new UnauthorizedError('Bạn cần đăng nhập để thực hiện thao tác này.'));
  if (!req.user.role) return next(new ForbiddenError('Không tìm thấy thông tin phân quyền.'));
  if (!allowedRoles.includes(req.user.role)) {
    return next(new ForbiddenError('Bạn không có quyền truy cập tài nguyên này.'));
  }
  return next();
};

const requireAdmin = (req, res, next) => authorizeRole('admin')(req, res, next);

/**
 * Host must be active AND HostProfile.IsVerified === true.
 */
async function requireVerifiedHost(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'host') {
      return next(new ForbiddenError('Chỉ host mới được truy cập.'));
    }
    const profile = await HostProfile.findOne({ UserID: req.user.userId }).select('IsVerified');
    if (!profile || !profile.IsVerified) {
      return next(
        new ForbiddenError('Tài khoản host chưa được admin phê duyệt. Vui lòng chờ xác minh.')
      );
    }
    req.hostVerified = true;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Page-level host auth: redirect to login instead of JSON.
 */
async function requireHostPage(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.redirect('/login');
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(decoded.userId || decoded.id);
    if (!user || user.Role !== 'host' || user.Status !== 'active') return res.redirect('/login');
    const tokenVersion = typeof decoded.tokenVersion === 'number' ? decoded.tokenVersion : 0;
    const dbVersion = typeof user.tokenVersion === 'number' ? user.tokenVersion : 0;
    if (tokenVersion !== dbVersion) return res.redirect('/login');

    const profile = await HostProfile.findOne({ UserID: user._id }).select('IsVerified');
    if (!profile || !profile.IsVerified) {
      return res.status(403).send('Tài khoản host chưa được admin phê duyệt.');
    }

    req.user = {
      userId: user._id.toString(),
      role: user.Role,
      status: user.Status,
      tokenVersion: dbVersion,
      email: user.Email,
      fullName: user.FullName,
    };
    req.currentUser = user;
    return next();
  } catch {
    return res.redirect('/login');
  }
}

module.exports = {
  verifyToken,
  optionalAuth,
  authorizeRole,
  requireAdmin,
  requireHostPage,
  requireVerifiedHost,
  extractToken,
};
