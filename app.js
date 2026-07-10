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
const requestTiming = require('./middlewares/requestTiming');
const apiVersion = require('./middlewares/apiVersion');
const maintenanceMode = require('./middlewares/maintenanceMode');
const { tracingMiddleware } = require('./utils/tracing');
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
const platformRoutes = require('./routes/platformRoutes');
const growthRoutes = require('./routes/growthRoutes');
const { getHostReportsPage } = require('./controllers/hostController');
const { expireStaleHolds } = require('./services/bookingService');
const { detectLang, t } = require('./services/i18n');

function createApp() {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(requestId);
  app.use(tracingMiddleware);
  app.use(requestTiming);
  app.use(apiVersion);

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
          // OSM embed on listing detail
          'frame-src': ["'self'", 'https://www.openstreetmap.org'],
          'child-src': ["'self'", 'https://www.openstreetmap.org'],
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
  app.use(maintenanceMode);

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    // External webhooks / partner API keys authenticate via signature or X-API-Key.
    const skip =
      (req.path === '/api/auth/login' && req.method === 'POST') ||
      (req.path === '/api/auth/2fa/verify' && req.method === 'POST') ||
      (req.path === '/api/auth/register' && req.method === 'POST') ||
      (req.path === '/api/auth/forgot-password' && req.method === 'POST') ||
      (req.path === '/api/auth/reset-password' && req.method === 'POST') ||
      (req.path === '/api/auth/email/confirm' && req.method === 'POST') ||
      (req.path === '/api/auth/webauthn/login/options' && req.method === 'POST') ||
      (req.path === '/api/auth/webauthn/login/verify' && req.method === 'POST') ||
      (req.path === '/api/auth/google/mock' && req.method === 'POST') ||
      (req.path === '/api/auth/csrf' && req.method === 'GET') ||
      (req.path === '/api/i18n/lang' && (req.method === 'POST' || req.method === 'PUT')) ||
      req.path === '/api/gateway/webhook' ||
      req.path === '/api/rum' ||
      req.path.startsWith('/api/partner/v1/');
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
  app.get('/health/details', async (req, res) => {
    const mongoose = require('mongoose');
    const metrics = require('./utils/metrics');
    const pkg = require('./package.json');
    res.json({
      status: mongoose.connection.readyState === 1 ? 'ok' : 'degraded',
      version: pkg.version,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      db: { readyState: mongoose.connection.readyState },
      redisConfigured: Boolean(process.env.REDIS_URL),
      metrics: metrics.snapshot(),
      timestamp: new Date().toISOString(),
    });
  });
  // Prometheus scrape (no auth — scrape via network policy / internal only in prod)
  app.get('/metrics', (req, res) => {
    const metrics = require('./utils/metrics');
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics.renderPrometheus());
  });

  // Views + layouts MUST be registered before any route that res.render()s HTML
  // (seoRoutes, page routes). Previously seoRoutes ran without layout → no <head>/JSON-LD.
  app.use(expressLayouts);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('layout', 'layout');

  // Public human-readable status (after views so layout works)
  app.get('/status', (req, res) => {
    res.render('customer/status', {
      pageTitle: 'Trạng thái hệ thống — WorkHub',
      metaDescription: 'Trạng thái và phiên bản WorkHub.',
      canonicalPath: '/status',
    });
  });

  app.use((req, res, next) => {
    res.locals.req = req;
    res.locals.branches = [];
    res.locals.keyword = '';
    // Expose for layout EJS (avoid relying on process in template)
    res.locals.useTailwindCdn =
      process.env.USE_TAILWIND_CDN === '1' || process.env.USE_TAILWIND_CDN === 'true'
        ? true
        : process.env.USE_TAILWIND_CDN === '0' || process.env.USE_TAILWIND_CDN === 'false'
          ? false
          : process.env.NODE_ENV !== 'production';
    res.locals.lang = detectLang(req);
    res.locals.t = (key, fb) => t(res.locals.lang, key, fb);
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

  app.use(seoRoutes);

  app.use('/api/auth', authRoutes);
  app.use('/api/customers', customerApiRoutes);
  app.use('/api/me', meExtraRoutes);
  app.use('/api/hosts', hostRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', platformRoutes);
  app.use('/api', growthRoutes);

  // Webhook needs raw-ish body for signature — express.json already parsed;
  // gatewayService signs JSON.stringify of object (stable enough for mock).

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
      loadChartJs: true,
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
      scripts: res.locals.scriptsFrom(['/js/host-spaces.js', '/js/host-inbox.js']),
    })
  );
  app.get('/host/onboarding', requireHostPage, (req, res) =>
    res.render('host/onboarding', {
      currentUser: req.currentUser,
      pageTitle: 'Onboarding — Host',
      scripts: res.locals.scriptsFrom(['/js/host-onboarding.js']),
    })
  );
  app.get('/host/calendar', requireHostPage, (req, res) =>
    res.render('host/calendar', {
      currentUser: req.currentUser,
      pageTitle: 'Lịch — Host',
      scripts: res.locals.scriptsFrom(['/js/host-calendar.js']),
    })
  );
  app.get('/host/reception', requireHostPage, (req, res) =>
    res.render('host/reception', {
      currentUser: req.currentUser,
      pageTitle: 'Lễ tân — Host',
      scripts: res.locals.scriptsFrom(['/js/host-reception.js']),
    })
  );
  app.get('/host/staff', requireHostPage, (req, res) =>
    res.render('host/staff', {
      currentUser: req.currentUser,
      pageTitle: 'Nhân viên — Host',
      scripts: res.locals.scriptsFrom(['/js/host-staff.js']),
    })
  );
  app.get('/host/ops', requireHostPage, (req, res) =>
    res.render('host/ops', {
      currentUser: req.currentUser,
      pageTitle: 'Bulk ops — Host',
      scripts: res.locals.scriptsFrom(['/js/host-ops.js']),
    })
  );
  app.get('/host/finance', requireHostPage, (req, res) =>
    res.render('host/finance', {
      currentUser: req.currentUser,
      pageTitle: 'Tài chính — Host',
      scripts: res.locals.scriptsFrom(['/js/host-finance.js']),
    })
  );
  app.get('/host/reports', requireHostPage, (req, res, next) => {
    res.locals.loadChartJs = true;
    return getHostReportsPage(req, res, next);
  });

  app.get('/compare', (req, res) =>
    res.render('customer/compare', {
      pageTitle: 'So sánh — WorkHub',
      scripts: res.locals.scriptsFrom(['/js/compare.js']),
    })
  );
  app.get('/support', (req, res) =>
    res.render('customer/support', {
      pageTitle: 'Hỗ trợ — WorkHub',
      scripts: res.locals.scriptsFrom(['/js/support.js']),
    })
  );
  app.get('/membership', (req, res) =>
    res.render('customer/membership', {
      pageTitle: 'Membership — WorkHub',
      scripts: res.locals.scriptsFrom(['/js/membership.js']),
    })
  );
  app.get('/messages', (req, res) =>
    res.render('customer/messages', {
      pageTitle: 'Tin nhắn — WorkHub',
      scripts: res.locals.scriptsFrom(['/js/messages.js']),
    })
  );
  app.get('/security', (req, res) =>
    res.render('customer/security', {
      pageTitle: 'Bảo mật — WorkHub',
      scripts: res.locals.scriptsFrom(['/js/security.js']),
    })
  );
  app.get('/booking/detail', (req, res) =>
    res.render('customer/booking-detail', {
      pageTitle: 'Chi tiết booking — WorkHub',
      scripts: res.locals.scriptsFrom(['/js/booking-detail.js']),
    })
  );
  app.get('/booking/recurring', (req, res) =>
    res.render('customer/booking-recurring', {
      pageTitle: 'Đặt chỗ lặp lại — WorkHub',
      scripts: res.locals.scriptsFrom(['/js/booking-recurring.js']),
    })
  );
  app.get('/booking/group', (req, res) =>
    res.render('customer/booking-group', {
      pageTitle: 'Đặt chỗ nhóm — WorkHub',
      scripts: res.locals.scriptsFrom(['/js/booking-group.js']),
    })
  );
  app.get('/rsvp/:token', (req, res) =>
    res.render('customer/rsvp', {
      pageTitle: 'RSVP — WorkHub',
      token: req.params.token,
      scripts: res.locals.scriptsFrom(['/js/rsvp.js']),
    })
  );
  app.get('/consent', (req, res) =>
    res.render('customer/consent', {
      pageTitle: 'Quyền riêng tư — WorkHub',
      scripts: res.locals.scriptsFrom(['/js/consent.js']),
    })
  );
  app.get('/hosts/:hostId', async (req, res, next) => {
    try {
      const data = await require('./services/publicHostService').getPublicHostProfile(
        req.params.hostId
      );
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: data.companyName,
        url: `${req.protocol}://${req.get('host')}/hosts/${data.hostId}`,
        logo: data.logo || undefined,
        aggregateRating:
          data.stats.ratingTotal > 0
            ? {
                '@type': 'AggregateRating',
                ratingValue: data.stats.ratingAverage,
                reviewCount: data.stats.ratingTotal,
              }
            : undefined,
      };
      res.render('customer/host-public', {
        host: data,
        pageTitle: `${data.companyName} — Host WorkHub`,
        metaDescription: `Host ${data.companyName}: ${data.stats.branchCount} cơ sở, đánh giá ${data.stats.ratingAverage}/5.`,
        canonicalPath: `/hosts/${data.hostId}`,
        jsonLd,
      });
    } catch (e) {
      if (e.statusCode === 404) return res.status(404).send('Không tìm thấy host');
      return next(e);
    }
  });
  app.get('/dashboard', (req, res) =>
    res.render('customer/dashboard', {
      pageTitle: 'Tổng quan — WorkHub',
      scripts: res.locals.scriptsFrom(['/js/dashboard.js']),
    })
  );
  app.get('/payment/gateway/:sessionId', (req, res) =>
    res.render('customer/gateway-checkout', {
      pageTitle: 'Thanh toán — WorkHub',
      sessionId: req.params.sessionId,
      scripts: res.locals.scriptsFrom(['/js/gateway-checkout.js']),
    })
  );
  app.get('/admin/disputes', requireAdminPage, (req, res) =>
    res.render('admin/disputes', {
      pageTitle: 'Disputes — Admin',
      scripts: res.locals.scriptsFrom(['/js/admin-disputes.js']),
    })
  );
  app.get('/admin/cms', requireAdminPage, (req, res) =>
    res.render('admin/cms', {
      pageTitle: 'CMS — Admin',
      scripts: res.locals.scriptsFrom(['/js/admin-cms.js']),
    })
  );
  app.get('/huong-dan/:slug', async (req, res, next) => {
    try {
      const cmsService = require('./services/cmsService');
      const page = await cmsService.getBySlug(req.params.slug);
      const jsonLd = [
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: page.Title,
          description: page.MetaDescription || page.Body.slice(0, 160),
          datePublished: page.PublishedAt || page.createdAt,
        },
      ];
      // FAQPage schema when body contains Q:/A: lines
      const qa = [];
      const lines = String(page.Body || '').split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const q = lines[i].match(/^Q:\s*(.+)/i);
        const a = lines[i + 1] && lines[i + 1].match(/^A:\s*(.+)/i);
        if (q && a) {
          qa.push({
            '@type': 'Question',
            name: q[1].trim(),
            acceptedAnswer: { '@type': 'Answer', text: a[1].trim() },
          });
        }
      }
      if (qa.length) {
        jsonLd.push({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: qa,
        });
      }
      res.render('customer/cms-page', {
        page,
        pageTitle: page.MetaTitle || page.Title,
        metaDescription: page.MetaDescription || page.Body.slice(0, 160),
        jsonLd,
      });
    } catch (e) {
      if (e.statusCode === 404) return res.status(404).send('Không tìm thấy');
      return next(e);
    }
  });

  // Admin pages protected
  const adminScriptList = ['/js/admin-main.js'];
  app.get('/admin/dashboard', requireAdminPage, (req, res) =>
    res.render('admin/dashboard', {
      scripts: res.locals.scriptsFrom(adminScriptList),
      pageTitle: 'Admin — WorkHub',
      loadChartJs: true,
    })
  );
  app.get('/admin/seo', requireAdminPage, (req, res) =>
    res.render('admin/seo', {
      pageTitle: 'SEO — Admin',
      scripts: res.locals.scriptsFrom(['/js/admin-seo.js']),
    })
  );
  app.get('/admin/flags', requireAdminPage, (req, res) =>
    res.render('admin/flags', {
      pageTitle: 'Feature flags — Admin',
      scripts: res.locals.scriptsFrom(['/js/admin-flags.js']),
    })
  );
  app.get('/admin/listings', requireAdminPage, (req, res) =>
    res.render('admin/listings', {
      pageTitle: 'Listing moderation — Admin',
      scripts: res.locals.scriptsFrom(['/js/admin-listings.js']),
    })
  );
  app.get('/admin/health', requireAdminPage, (req, res) =>
    res.render('admin/health', {
      pageTitle: 'System health — Admin',
      scripts: res.locals.scriptsFrom(['/js/admin-health.js']),
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
