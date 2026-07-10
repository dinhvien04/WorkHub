'use strict';

const express = require('express');
const {
  verifyToken,
  authorizeRole,
  requireAdmin,
  requireVerifiedHost,
} = require('../middlewares/authMiddleware');
const { requireApiKey, requireScope } = require('../middlewares/apiKeyAuth');
const g = require('../controllers/growthController');

const router = express.Router();

// Gateway
router.post('/gateway/checkout', verifyToken, authorizeRole('customer'), g.createCheckout);
router.post('/gateway/webhook', g.gatewayWebhook); // signature verified inside
router.get('/gateway/sessions/:sessionId', g.getGatewaySession);
router.post(
  '/gateway/sessions/:sessionId/mock-complete',
  verifyToken,
  authorizeRole('customer'),
  g.mockCompleteGateway
);

// Payouts
router.post('/host/payouts', verifyToken, authorizeRole('host'), requireVerifiedHost, g.requestPayout);
router.get('/host/payouts', verifyToken, authorizeRole('host'), requireVerifiedHost, g.listPayouts);
router.put('/admin/payouts/:payoutId/process', verifyToken, requireAdmin, g.adminProcessPayout);

// Membership
router.get('/membership/plans', g.listPlans);
router.get('/membership/me', verifyToken, g.myMembership);
router.post('/membership/subscribe', verifyToken, authorizeRole('customer'), g.subscribe);

// Recurring + corporate
router.post('/bookings/recurring', verifyToken, authorizeRole('customer'), g.createRecurring);
router.post('/bookings/group', verifyToken, authorizeRole('customer'), g.createGroupBooking);

// Fraud
router.post('/fraud/preview', verifyToken, g.fraudPreview);

// Partner API keys (user-owned)
router.post('/partner/keys', verifyToken, g.createApiKey);
router.get('/partner/keys', verifyToken, g.listApiKeys);
router.delete('/partner/keys/:id', verifyToken, g.revokeApiKey);

// Partner data plane (API key)
router.get(
  '/partner/v1/spaces',
  requireApiKey,
  requireScope('spaces:read'),
  g.partnerListSpaces
);
router.get(
  '/partner/v1/bookings/:id',
  requireApiKey,
  requireScope('bookings:read'),
  g.partnerGetBooking
);

// Sessions / security
router.get('/sessions', verifyToken, g.listSessions);
router.post('/sessions/logout-all', verifyToken, g.logoutAll);

// i18n
router.get('/i18n', g.i18nBundle);

// RUM beacon (public, no auth — no PII accepted)
router.post('/rum', g.rumBeacon);

// External calendar feed
router.get('/feeds/host/:hostId/calendar.ics', g.hostIcalFeed);

// Admin ops
router.get('/admin/dead-letters', verifyToken, requireAdmin, g.listDeadLetters);

// Host advanced report
router.get(
  '/host/reports/advanced',
  verifyToken,
  authorizeRole('host'),
  requireVerifiedHost,
  g.hostAdvancedReport
);

// QR check-in + no-show
router.post(
  '/bookings/:bookingId/check-in-token',
  verifyToken,
  g.mintCheckIn
);
router.post(
  '/host/check-in/scan',
  verifyToken,
  authorizeRole('host'),
  requireVerifiedHost,
  g.scanCheckIn
);
router.post(
  '/host/bookings/:bookingId/no-show',
  verifyToken,
  authorizeRole('host'),
  requireVerifiedHost,
  g.markNoShow
);

// Notification preferences
router.get('/me/notification-prefs', verifyToken, g.getNotifyPrefs);
router.put('/me/notification-prefs', verifyToken, g.updateNotifyPrefs);

// Admin system + SEO redirects
router.get('/admin/system-health', verifyToken, requireAdmin, g.systemHealth);
router.get('/admin/seo/redirects', verifyToken, requireAdmin, g.listSeoRedirects);
router.put('/admin/seo/redirects', verifyToken, requireAdmin, g.upsertSeoRedirect);

// Alternatives + add-ons (public read)
router.get('/availability/alternatives', g.alternativeSlots);
router.get('/addons', g.publicAddOns);

// Receipt + finance export
router.get(
  '/bookings/:bookingId/receipt',
  verifyToken,
  g.bookingReceipt
);
router.get(
  '/host/ledger/export.csv',
  verifyToken,
  authorizeRole('host'),
  requireVerifiedHost,
  g.exportLedgerCsv
);

// Reviews
router.post('/reviews/:reviewId/report', verifyToken, g.reportReview);
router.put('/admin/reviews/:reviewId/moderate', verifyToken, requireAdmin, g.moderateReview);
router.post(
  '/host/reviews/:reviewId/reply',
  verifyToken,
  authorizeRole('host'),
  requireVerifiedHost,
  g.hostReplyReview
);

// Timeline + cancel policy preview
router.get('/bookings/:bookingId/timeline', verifyToken, g.bookingTimeline);
router.get('/bookings/:bookingId/cancel-preview', verifyToken, g.cancelPreview);

// Host inbox + onboarding
router.get(
  '/host/inbox',
  verifyToken,
  authorizeRole('host'),
  requireVerifiedHost,
  g.hostInbox
);
router.get(
  '/host/onboarding',
  verifyToken,
  authorizeRole('host'),
  g.hostOnboarding
);

// Admin force logout
router.post(
  '/admin/users/:userId/force-logout',
  verifyToken,
  requireAdmin,
  g.adminForceLogout
);

module.exports = router;
