'use strict';

const featureFlagService = require('../services/featureFlagService');

/**
 * Platform maintenance / kill switch for mutating API.
 * Flag: kill_switch_platform or env MAINTENANCE_MODE=1
 * Always allows: health, webhooks, auth login/csrf, admin.
 */
async function maintenanceMode(req, res, next) {
  try {
    const envOn =
      process.env.MAINTENANCE_MODE === '1' || process.env.MAINTENANCE_MODE === 'true';
    if (!envOn) {
      // cheap skip if no flag likely — still check flag for kill switch
      const path = req.path || '';
      if (
        path.startsWith('/health') ||
        path === '/api/rum' ||
        path === '/api/gateway/webhook' ||
        path.startsWith('/api/auth/') ||
        path.startsWith('/api/admin') ||
        req.method === 'GET' ||
        req.method === 'HEAD' ||
        req.method === 'OPTIONS'
      ) {
        // still allow GET; only block writes when maintenance
      }
    }

    const flagOn = await featureFlagService.isEnabled('kill_switch_platform', {
      userId: req.user?.userId,
      role: req.user?.role,
    });
    const on = envOn || flagOn;
    if (!on) return next();

    const path = req.path || '';
    const allow =
      path.startsWith('/health') ||
      path === '/api/gateway/webhook' ||
      path === '/api/rum' ||
      path === '/api/auth/csrf' ||
      path === '/api/auth/login' ||
      path === '/api/auth/2fa/verify' ||
      path.startsWith('/api/admin') ||
      req.method === 'GET' ||
      req.method === 'HEAD' ||
      req.method === 'OPTIONS';

    if (allow) return next();

    return res.status(503).json({
      error: 'Hệ thống đang bảo trì. Vui lòng thử lại sau.',
      code: 'MAINTENANCE',
    });
  } catch {
    return next();
  }
}

module.exports = maintenanceMode;
