"use strict";

const express = require("express");
const {
  verifyToken,
  authorizeRole,
  requireVerifiedHost,
  optionalAuth,
} = require("../middlewares/authMiddleware");
const {
  resolveHostContext,
  requireStaffPermission,
} = require("../middlewares/hostContext");
const {
  rsvpLimiter,
  checkInLimiter,
} = require("../middlewares/rateLimiters");

const c = require("../controllers/bookingController");
const router = express.Router();

const host = [verifyToken, authorizeRole("host"), requireVerifiedHost];

// Customer / General Booking routes
router.get("/bookings/:bookingId/reschedule-preview", verifyToken, c.reschedulePreview);
router.post("/bookings/:bookingId/reschedule-preview", verifyToken, c.reschedulePreview);
router.put("/bookings/:bookingId/reschedule", verifyToken, c.reschedule);

router.post("/bookings/recurring/preview", verifyToken, authorizeRole("customer"), c.previewRecurring);
router.get("/bookings/recurring/preview", verifyToken, authorizeRole("customer"), c.previewRecurring);
router.post("/bookings/recurring", verifyToken, authorizeRole("customer"), c.createRecurring);
router.get("/bookings/recurring", verifyToken, authorizeRole("customer"), c.listRecurring);
router.put("/bookings/recurring/:seriesId/cancel", verifyToken, authorizeRole("customer"), c.cancelRecurring);

router.post("/bookings/group", verifyToken, authorizeRole("customer"), c.createGroupBooking);
router.get("/bookings/:bookingId/group-invites", verifyToken, authorizeRole("customer", "host"), c.listGroupInvites);
router.get("/rsvp/:token", rsvpLimiter, c.getGroupInvitePublic);
router.post("/rsvp/:token", rsvpLimiter, c.rsvpGroupInvite);

router.post("/bookings/:bookingId/check-in-token", verifyToken, checkInLimiter, c.mintCheckIn);
router.get("/me/dashboard", verifyToken, authorizeRole("customer"), c.customerDashboard);
router.get("/availability/alternatives", c.alternativeSlots);
router.get("/addons", c.publicAddOns);
router.get("/bookings/quote", optionalAuth, c.quoteBooking);
router.post("/bookings/quote", optionalAuth, c.quoteBooking);
router.get("/bookings/:bookingId/receipt", verifyToken, c.bookingReceipt);
router.get("/bookings/:bookingId/timeline", verifyToken, c.bookingTimeline);
router.get("/bookings/:bookingId/cancel-preview", verifyToken, c.cancelPreview);

// Host Booking routes
router.get("/host/addons", ...host, c.listAddOns);
router.post("/host/addons", ...host, c.createAddOn);
router.get("/host/blackouts", ...host, c.listBlackouts);
router.post("/host/blackouts", ...host, c.createBlackout);
router.delete("/host/blackouts/:blackoutId", ...host, c.deleteBlackout);
router.post("/host/spaces/bulk", ...host, c.bulkSpaces);
router.post("/host/spaces/bulk-status", ...host, c.bulkSpaceStatus);
router.get("/host/reception/today", ...host, c.receptionToday);
router.put("/host/bookings/:bookingId/checkout", ...host, c.checkout);
router.post(
  "/host/incidents",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("incident:create"),
  c.createIncident
);
router.post("/host/check-in/scan", verifyToken, authorizeRole("host"), requireVerifiedHost, checkInLimiter, c.scanCheckIn);
router.post("/host/bookings/:bookingId/no-show", verifyToken, authorizeRole("host"), requireVerifiedHost, c.markNoShow);
router.get("/host/inbox", verifyToken, authorizeRole("host"), requireVerifiedHost, c.hostInbox);
router.get("/host/onboarding", verifyToken, authorizeRole("host"), c.hostOnboarding);
router.get("/host/bookings/:bookingId/notes", verifyToken, authorizeRole("host"), requireVerifiedHost, c.listHostNotes);
router.post("/host/bookings/:bookingId/notes", verifyToken, authorizeRole("host"), requireVerifiedHost, c.addHostNote);
router.patch("/host/spaces/:spaceId/ops", verifyToken, authorizeRole("host"), requireVerifiedHost, c.patchSpaceOps);

// Staff Booking routes
router.get(
  "/staff/host/inbox",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("reception:view"),
  c.staffHostInbox
);
router.get(
  "/staff/host/reception/today",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("reception:view"),
  c.staffReceptionToday
);
router.post(
  "/staff/host/check-in/scan",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("booking:checkin"),
  c.staffScanCheckIn
);
router.get(
  "/staff/host/calendar",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("calendar:view"),
  c.staffHostCalendar
);
router.put(
  "/staff/host/bookings/:bookingId/confirm",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("booking:manage"),
  c.staffConfirmBooking
);
router.post(
  "/staff/host/bookings/:bookingId/no-show",
  verifyToken,
  resolveHostContext,
  requireStaffPermission("booking:manage"),
  c.staffNoShow
);

module.exports = router;
