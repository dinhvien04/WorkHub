'use strict';

/**
 * Express application factory — does not listen.
 */
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');

const env = require('./config/env');
const requestId = require('./middlewares/requestId');
const { ensureCsrfCookie, csrfProtection } = require('./middlewares/csrfMiddleware');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');
const { requireHostPage, requireAdminPage } = require('./middlewares/authMiddleware');

const authRoutes = require('./routes/authRoutes');
const customerApiRoutes = require('./routes/customerApiRoutes');
const customerPageRoutes = require('./routes/customerPageRoutes');
const hostRoutes = require('./routes/hostRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const seoRoutes = require('./routes/seoRoutes');
const meExtraRoutes = require('./routes/meExtraRoutes');
const { getHostReportsPage } = require('./controllers/hostController');
const { expireStaleHolds } = require('./services/bookingService');

function createApp() {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(requestId);

  // Per-request CSP nonce (no 'unsafe-inline' for scripts)
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': [
            "'self'",
            (req, res) => `'nonce-${res.locals.cspNonce}'`,
            'https://cdn.tailwindcss.com',
            'https://cdn.jsdelivr.net',
            'https://cdnjs.cloudflare.com',
          ],
          // Tailwind CDN injects styles; keep limited inline styles for CSS-in-JS CDN
          'style-src': [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
            'https://cdn.jsdelivr.net',
            'https://cdnjs.cloudflare.com',
          ],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': ["'self'", 'data:', 'https:', 'blob:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));
  app.use(cookieParser());
  app.use(ensureCsrfCookie);

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const skip =
      (req.path === '/api/auth/login' && req.method === 'POST') ||
      (req.path === '/api/auth/register' && req.method === 'POST') ||
      (req.path === '/api/auth/forgot-password' && req.method === 'POST') ||
      (req.path === '/api/auth/reset-password' && req.method === 'POST') ||
      (req.path === '/api/auth/csrf' && req.method === 'GET');
    if (skip) return next();
    return csrfProtection(req, res, next);
  });

  // Hashed/static assets long cache; HTML no-store via default
  app.use(
    express.static(path.join(__dirname, 'public'), {
      maxAge: env.isProduction ? '7d' : 0,
      setHeaders(res, filePath) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (/\.(js|css|woff2?|png|jpe?g|webp|avif|svg)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        }
      },
    })
  );
  app.use(
    '/uploads',
    express.static(path.join(__dirname, 'public', 'uploads'), {
      setHeaders(res) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    })
  );

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/health/live', (req, res) => res.json({ status: 'live' }));
  app.get('/health/ready', async (req, res) => {
    try {
      const mongoose = require('mongoose');
      const ok = mongoose.connection.readyState === 1;
      res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not_ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  app.use(seoRoutes);

  app.use('/api/auth', authRoutes);
  app.use('/api/customers', customerApiRoutes);
  app.use('/api/me', meExtraRoutes);
  app.use('/api/hosts', hostRoutes);
  app.use('/api/admin', adminRoutes);

  // Best-effort: expire holds on hot path for small deployments
  app.use(async (req, res, next) => {
    if (req.method === 'GET' || Math.random() > 0.05) return next();
    try {
      await expireStaleHolds();
    } catch {
      /* ignore */
    }
    return next();
  });

  app.use(expressLayouts);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('layout', 'layout');

  app.use((req, res, next) => {
    res.locals.req = req;
    res.locals.branches = [];
    res.locals.keyword = '';
    res.locals.csrfToken = res.locals.csrfToken || (req.cookies && req.cookies.csrfToken) || '';
    res.locals.pageTitle = res.locals.pageTitle || 'WorkHub - Đặt chỗ Co-working';
    res.locals.metaDescription =
      res.locals.metaDescription ||
      'WorkHub — tìm và đặt chỗ co-working, phòng họp nhanh, an toàn.';
    res.locals.canonicalPath = res.locals.canonicalPath || req.path;
    // Helper for page scripts with CSP nonce
    res.locals.scriptSrc = function scriptSrc(src) {
      const n = res.locals.cspNonce || '';
      return `<script nonce="${n}" src="${src}"></script>`;
    };
    res.locals.scriptsFrom = function scriptsFrom(list) {
      return (list || []).map((s) => res.locals.scriptSrc(s)).join('');
    };
    next();
  });

  app.get('/login', (req, res) => res.render('customer/login', { pageTitle: 'Đăng nhập — WorkHub' }));
  app.get('/register', (req, res) => res.render('customer/register', { pageTitle: 'Đăng ký — WorkHub' }));

  app.use('/host', requireHostPage, paymentRoutes);
  app.get('/host/profile', requireHostPage, (req, res) =>
    res.render('host/profile', {
      currentUser: req.currentUser,
      scripts: res.locals.scriptsFrom(['/js/host-spaces.js', '/js/host-profile.js']),
    })
  );
  app.get('/host/dashboard', requireHostPage, (req, res) =>
    res.render('host/dashboard', {
      currentUser: req.currentUser,
      scripts: res.locals.scriptsFrom(['/js/host-spaces.js', '/js/host-dashboard.js']),
    })
  );
  app.get('/host/spaces', requireHostPage, (req, res) =>
    res.render('host/spaces', {
      currentUser: req.currentUser,
      scripts: res.locals.scriptsFrom(['/js/host-spaces.js']),
    })
  );
  app.get('/host/bookings', requireHostPage, (req, res) =>
    res.render('host/bookings', {
      currentUser: req.currentUser,
      scripts: res.locals.scriptsFrom(['/js/host-spaces.js']),
    })
  );
  app.get('/host/calendar', requireHostPage, (req, res) =>
    res.render('host/calendar', {
      currentUser: req.currentUser,
      pageTitle: 'Lịch — Host',
      scripts: res.locals.scriptsFrom(['/js/host-calendar.js']),
    })
  );
  app.get('/host/reports', requireHostPage, getHostReportsPage);

  // Admin pages protected
  const adminScriptList = ['/js/admin-main.js'];
  app.get('/admin/dashboard', requireAdminPage, (req, res) =>
    res.render('admin/dashboard', {
      scripts: res.locals.scriptsFrom(adminScriptList),
      pageTitle: 'Admin — WorkHub',
    })
  );
  app.get('/admin/users', requireAdminPage, (req, res) =>
    res.render('admin/users', {
      scripts: res.locals.scriptsFrom(adminScriptList),
      pageTitle: 'Users — Admin',
    })
  );
  app.get('/admin/hosts', requireAdminPage, (req, res) =>
    res.render('admin/hosts', {
      scripts: res.locals.scriptsFrom(adminScriptList),
      pageTitle: 'Hosts — Admin',
    })
  );
  app.get('/admin/activitylog', requireAdminPage, (req, res) =>
    res.render('admin/activitylog', {
      scripts: res.locals.scriptsFrom(adminScriptList),
      pageTitle: 'Audit — Admin',
    })
  );

  app.use('/', customerPageRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
