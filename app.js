'use strict';

/**
 * Express application factory — does not listen.
 * Import this in tests and from server.js.
 */
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');

const env = require('./config/env');
const requestId = require('./middlewares/requestId');
const { ensureCsrfCookie, csrfProtection } = require('./middlewares/csrfMiddleware');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');
const { requireHostPage } = require('./middlewares/authMiddleware');

const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const hostRoutes = require('./routes/hostRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const { getHostReportsPage } = require('./controllers/hostController');

function createApp() {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(requestId);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': ["'self'", 'data:', 'https:', 'blob:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));
  app.use(cookieParser());
  app.use(ensureCsrfCookie);

  // CSRF on state-changing /api/* (except login/register which establish session)
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const skip =
      (req.path === '/api/auth/login' && req.method === 'POST') ||
      (req.path === '/api/auth/register' && req.method === 'POST') ||
      (req.path === '/api/auth/forgot-password' && req.method === 'POST') ||
      (req.path === '/api/auth/reset-password' && req.method === 'POST') ||
      (req.path === '/api/auth/csrf' && req.method === 'GET') ||
      (req.path === '/api/auth/logout' && req.method === 'POST');
    if (skip) return next();
    return csrfProtection(req, res, next);
  });

  app.use(express.static(path.join(__dirname, 'public')));
  // Do not expose arbitrary uploads of sensitive docs — only public assets
  app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), {
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/hosts', hostRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(expressLayouts);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('layout', 'layout');

  app.use((req, res, next) => {
    res.locals.req = req;
    res.locals.branches = [];
    res.locals.keyword = '';
    res.locals.csrfToken = res.locals.csrfToken || (req.cookies && req.cookies.csrfToken) || '';
    next();
  });

  app.get('/login', (req, res) => res.render('customer/login'));
  app.get('/register', (req, res) => res.render('customer/register'));

  app.use('/host', requireHostPage, paymentRoutes);
  app.get('/host/profile', requireHostPage, (req, res) =>
    res.render('host/profile', {
      currentUser: req.currentUser,
      scripts: '<script src="/js/host-spaces.js"></script>',
    })
  );
  app.get('/host/dashboard', requireHostPage, (req, res) =>
    res.render('host/dashboard', {
      currentUser: req.currentUser,
      scripts: '<script src="/js/host-spaces.js"></script><script src="/js/host-dashboard.js"></script>',
    })
  );
  app.get('/host/spaces', requireHostPage, (req, res) =>
    res.render('host/spaces', {
      currentUser: req.currentUser,
      scripts: '<script src="/js/host-spaces.js"></script>',
    })
  );
  app.get('/host/bookings', requireHostPage, (req, res) =>
    res.render('host/bookings', {
      currentUser: req.currentUser,
      scripts: '<script src="/js/host-spaces.js"></script>',
    })
  );
  app.get('/host/reports', requireHostPage, getHostReportsPage);
  app.get('/host/payments', requireHostPage, (req, res, next) => {
    // handled by paymentRoutes when mounted at /host — also explicit fallback
    next();
  });

  app.get('/admin/dashboard', (req, res) =>
    res.render('admin/dashboard', { scripts: '<script src="/js/admin-main.js"></script>' })
  );
  app.get('/admin/users', (req, res) =>
    res.render('admin/users', { scripts: '<script src="/js/admin-main.js"></script>' })
  );
  app.get('/admin/hosts', (req, res) =>
    res.render('admin/hosts', { scripts: '<script src="/js/admin-main.js"></script>' })
  );
  app.get('/admin/activitylog', (req, res) =>
    res.render('admin/activitylog', { scripts: '<script src="/js/admin-main.js"></script>' })
  );

  // Customer pages + APIs under /
  app.use('/', customerRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
