"use strict";

const express = require("express");
const {
  verifyToken,
  authorizeRole,
  requireAdmin,
  requireVerifiedHost,
} = require("../middlewares/authMiddleware");
const { requireApiKey, requireScope } = require("../middlewares/apiKeyAuth");
const {
  rumLimiter,
  rsvpLimiter,
  reviewReportLimiter,
  icalLimiter,
  checkInLimiter,
  pushSubscriptionLimiter,
} = require("../middlewares/rateLimiters");
const g = require("../controllers/growthController");

const router = express.Router();

// Gateway
const env = require("../config/env");
router.get("/gateway/providers", g.listGatewayProviders);
router.post(
  "/gateway/checkout",
  verifyToken,
  authorizeRole("customer"),
  g.createCheckout,
);
// Webhook raw-body route is mounted in app.js before express.json()
router.get(
  "/gateway/sessions/:sessionId",
  verifyToken,
  authorizeRole("customer"),
  g.getGatewaySession,
);
// Mock complete: never registered in production
if (!env.isProduction && env.ALLOW_MOCK_COMPLETE) {
  router.post(
    "/gateway/sessions/:sessionId/mock-complete",
    verifyToken,
    authorizeRole("customer"),
    g.mockCompleteGateway,
  );
}

// Payouts
router.post(
  "/host/payouts",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.requestPayout,
);
router.get(
  "/host/payouts",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.listPayouts,
);
router.get("/admin/payouts", verifyToken, requireAdmin, g.adminListPayouts);
router.put(
  "/admin/payouts/:payoutId/process",
  verifyToken,
  requireAdmin,
  g.adminProcessPayout,
);

// Refunds list (customer / host / admin)
router.get("/refunds", verifyToken, g.listRefunds);
router.get(
  "/host/refunds",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.listRefunds,
);
router.get("/admin/refunds", verifyToken, requireAdmin, g.listRefunds);

// Membership
router.get("/membership/plans", g.listPlans);
router.get(
  "/membership/me",
  verifyToken,
  authorizeRole("customer"),
  g.myMembership,
);
router.get(
  "/membership/credits",
  verifyToken,
  authorizeRole("customer"),
  g.myCreditLedger,
);
router.post(
  "/membership/subscribe",
  verifyToken,
  authorizeRole("customer"),
  g.subscribe,
);

// Recurring + corporate / group + RSVP
router.post(
  "/bookings/recurring/preview",
  verifyToken,
  authorizeRole("customer"),
  g.previewRecurring,
);
router.get(
  "/bookings/recurring/preview",
  verifyToken,
  authorizeRole("customer"),
  g.previewRecurring,
);
router.post(
  "/bookings/recurring",
  verifyToken,
  authorizeRole("customer"),
  g.createRecurring,
);
router.get(
  "/bookings/recurring",
  verifyToken,
  authorizeRole("customer"),
  g.listRecurring,
);
router.put(
  "/bookings/recurring/:seriesId/cancel",
  verifyToken,
  authorizeRole("customer"),
  g.cancelRecurring,
);
router.post(
  "/bookings/group",
  verifyToken,
  authorizeRole("customer"),
  g.createGroupBooking,
);
router.get(
  "/bookings/:bookingId/group-invites",
  verifyToken,
  authorizeRole("customer", "host"),
  g.listGroupInvites,
);
router.get("/rsvp/:token", rsvpLimiter, g.getGroupInvitePublic);
router.post("/rsvp/:token", rsvpLimiter, g.rsvpGroupInvite);

// Fraud
router.post("/fraud/preview", verifyToken, g.fraudPreview);

// Partner API keys (user-owned)
router.post(
  "/partner/keys",
  verifyToken,
  authorizeRole("host", "admin"),
  g.createApiKey,
);
router.get("/partner/keys", verifyToken, g.listApiKeys);
router.delete("/partner/keys/:id", verifyToken, g.revokeApiKey);

// Partner data plane (API key)
router.get(
  "/partner/v1/spaces",
  requireApiKey,
  requireScope("spaces:read"),
  g.partnerListSpaces,
);
router.get(
  "/partner/v1/bookings/:id",
  requireApiKey,
  requireScope("bookings:read"),
  g.partnerGetBooking,
);

// Sessions / security
router.get("/sessions", verifyToken, g.listSessions);
router.delete("/sessions/:id", verifyToken, g.revokeSession);
router.post("/sessions/logout-all", verifyToken, g.logoutAll);

// i18n — use central optionalAuth (status/tokenVersion checks)
const { optionalAuth } = require("../middlewares/authMiddleware");
router.get("/i18n", g.i18nBundle);
router.post("/i18n/lang", optionalAuth, g.setLang);
router.put("/i18n/lang", optionalAuth, g.setLang);

// RUM beacon (public, no auth — no PII accepted)
router.post("/rum", rumLimiter, g.rumBeacon);

// External calendar feed (random token; rotate/revoke via host API)
router.get("/feeds/host/:hostId/calendar.ics", icalLimiter, g.hostIcalFeed);
router.post(
  "/host/ical/token",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.rotateIcalToken,
);
router.delete(
  "/host/ical/token",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.revokeIcalToken,
);

// Admin ops
router.get("/admin/dead-letters", verifyToken, requireAdmin, g.listDeadLetters);
router.post(
  "/admin/dead-letters/:id/replay",
  verifyToken,
  requireAdmin,
  g.replayDeadLetter,
);
router.delete(
  "/admin/dead-letters/:id",
  verifyToken,
  requireAdmin,
  g.discardDeadLetter,
);

// Host advanced report
router.get(
  "/host/reports/advanced",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.hostAdvancedReport,
);

// QR check-in + no-show
router.post(
  "/bookings/:bookingId/check-in-token",
  verifyToken,
  checkInLimiter,
  g.mintCheckIn,
);
router.post(
  "/host/check-in/scan",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  checkInLimiter,
  g.scanCheckIn,
);
router.post(
  "/host/bookings/:bookingId/no-show",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.markNoShow,
);

// Notification preferences
router.get("/me/notification-prefs", verifyToken, g.getNotifyPrefs);
router.put("/me/notification-prefs", verifyToken, g.updateNotifyPrefs);

// Customer dashboard
router.get(
  "/me/dashboard",
  verifyToken,
  authorizeRole("customer"),
  g.customerDashboard,
);

// Admin system + SEO redirects
router.get("/admin/system-health", verifyToken, requireAdmin, g.systemHealth);
router.get(
  "/admin/seo/redirects",
  verifyToken,
  requireAdmin,
  g.listSeoRedirects,
);
router.put(
  "/admin/seo/redirects",
  verifyToken,
  requireAdmin,
  g.upsertSeoRedirect,
);
router.delete(
  "/admin/seo/redirects/:id",
  verifyToken,
  requireAdmin,
  g.deleteSeoRedirect,
);
router.patch(
  "/admin/seo/redirects/:id",
  verifyToken,
  requireAdmin,
  g.toggleSeoRedirect,
);

// Alternatives + add-ons + quote (public read; coupon applies when auth present)
router.get("/availability/alternatives", g.alternativeSlots);
router.get("/addons", g.publicAddOns);
router.get("/bookings/quote", optionalAuth, g.quoteBooking);
router.post("/bookings/quote", optionalAuth, g.quoteBooking);

// Receipt + finance export
router.get("/bookings/:bookingId/receipt", verifyToken, g.bookingReceipt);
router.get(
  "/host/ledger/export.csv",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.exportLedgerCsv,
);
router.post(
  "/host/exports/ledger",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.enqueueLedgerExport,
);
router.post(
  "/host/exports/bookings",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.enqueueBookingsExport,
);
router.get("/jobs/me", verifyToken, g.listMyJobs);
router.get("/jobs/:jobId", verifyToken, g.getJobStatus);
router.get("/jobs/:jobId/download", verifyToken, g.downloadJobFile);
router.post("/jobs/:jobId/retry", verifyToken, g.retryJob);

// Reviews
router.post(
  "/reviews/:reviewId/report",
  verifyToken,
  reviewReportLimiter,
  g.reportReview,
);
router.get("/admin/reviews", verifyToken, requireAdmin, g.listAdminReviews);
router.put(
  "/admin/reviews/:reviewId/moderate",
  verifyToken,
  requireAdmin,
  g.moderateReview,
);
router.get(
  "/host/reviews",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.listHostReviews,
);
router.post(
  "/host/reviews/:reviewId/reply",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.hostReplyReview,
);

// Public host profile
router.get("/public/hosts/:hostId", g.publicHostProfile);

// Timeline + cancel policy preview
router.get("/bookings/:bookingId/timeline", verifyToken, g.bookingTimeline);
router.get("/bookings/:bookingId/cancel-preview", verifyToken, g.cancelPreview);

// Host inbox + onboarding
router.get(
  "/host/inbox",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.hostInbox,
);
router.get(
  "/host/onboarding",
  verifyToken,
  authorizeRole("host"),
  g.hostOnboarding,
);

// Admin force logout
router.post(
  "/admin/users/:userId/force-logout",
  verifyToken,
  requireAdmin,
  g.adminForceLogout,
);

// Host notes + space ops
router.get(
  "/host/bookings/:bookingId/notes",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.listHostNotes,
);
router.post(
  "/host/bookings/:bookingId/notes",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.addHostNote,
);
router.patch(
  "/host/spaces/:spaceId/ops",
  verifyToken,
  authorizeRole("host"),
  requireVerifiedHost,
  g.patchSpaceOps,
);

// Privacy policy meta (public)
router.get("/privacy/policy", g.privacyPolicy);

// Staff memberships + host permissions matrix for UI
router.get("/staff/me", verifyToken, g.myStaffMemberships);
router.get("/host/me/permissions", verifyToken, g.myHostPermissions);

// Staff-accessible inbox (host or staff with booking:manage / reception)
const {
  resolveHostContext,
  requireStaffPermission,
} = require("../middlewares/hostContext");
router.get(
  "/staff/host/inbox",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("reception:view"),
  g.staffHostInbox,
);
router.get(
  "/staff/host/reception/today",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("reception:view"),
  g.staffReceptionToday,
);
router.post(
  "/staff/host/check-in/scan",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("booking:checkin"),
  g.staffScanCheckIn,
);
router.get(
  "/staff/host/calendar",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("calendar:view"),
  g.staffHostCalendar,
);
router.put(
  "/staff/host/bookings/:bookingId/confirm",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("booking:manage"),
  g.staffConfirmBooking,
);
router.post(
  "/staff/host/bookings/:bookingId/no-show",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("booking:manage"),
  g.staffNoShow,
);

// Web Push
router.get("/push/vapid-public-key", g.pushVapidPublic);
router.post(
  "/push/subscribe",
  verifyToken,
  pushSubscriptionLimiter,
  g.pushSubscribe,
);
router.post(
  "/push/unsubscribe",
  verifyToken,
  pushSubscriptionLimiter,
  g.pushUnsubscribe,
);

module.exports = router;
