'use strict';

const User = require('../models/User');
const featureFlagService = require('../services/featureFlagService');
const { ForbiddenError } = require('../utils/errors');

/**
 * When flag/env admin_require_2fa is on, admins must have TotpEnabled.
 */
async function requireAdmin2faIfEnabled(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'admin') return next();
    const envOn = process.env.ADMIN_REQUIRE_2FA === '1' || process.env.ADMIN_REQUIRE_2FA === 'true';
    const flagOn = await featureFlagService.isEnabled('admin_require_2fa', {
      userId: req.user.userId,
      role: 'admin',
    });
    if (!envOn && !flagOn) return next();

    const user = await User.findById(req.user.userId).select('TotpEnabled');
    if (!user?.TotpEnabled) {
      return next(
        new ForbiddenError(
          'Admin bắt buộc bật 2FA. Vào /security để thiết lập TOTP trước khi dùng admin API.'
        )
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAdmin2faIfEnabled };
