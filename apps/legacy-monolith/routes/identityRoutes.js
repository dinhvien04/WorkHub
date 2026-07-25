"use strict";

const express = require("express");
const {
  verifyToken,
  authorizeRole,
  requireAdmin,
  requireVerifiedHost,
} = require("../middlewares/authMiddleware");
const { requireApiKey, requireScope } = require("../middlewares/apiKeyAuth");
const { icalLimiter } = require("../middlewares/rateLimiters");

const c = require("../controllers/identityController");
const router = express.Router();

const host = [verifyToken, authorizeRole("host"), requireVerifiedHost];

// General / Customer Identity / Session routes
router.post("/staff/accept", verifyToken, c.acceptStaffInvite);
router.get("/sessions", verifyToken, c.listSessions);
router.delete("/sessions/:id", verifyToken, c.revokeSession);
router.post("/sessions/logout-all", verifyToken, c.logoutAll);
router.get("/staff/me", verifyToken, c.myStaffMemberships);
router.get("/host/me/permissions", verifyToken, c.myHostPermissions);

// Host Identity / Staff routes
router.get("/host/staff", ...host, c.listStaff);
router.post("/host/staff/invite", ...host, c.inviteStaff);
router.delete("/host/staff/:staffId", ...host, c.revokeStaff);

// Host Calendar Feed routes
router.get("/feeds/host/:hostId/calendar.ics", icalLimiter, c.hostIcalFeed);
router.post("/host/ical/token", ...host, c.rotateIcalToken);
router.delete("/host/ical/token", ...host, c.revokeIcalToken);

// Partner API Keys management
router.post(
  "/partner/keys",
  verifyToken,
  authorizeRole("host", "admin"),
  c.createApiKey
);
router.get("/partner/keys", verifyToken, c.listApiKeys);
router.delete("/partner/keys/:id", verifyToken, c.revokeApiKey);

// Partner Data plane (API Key authenticated)
router.get(
  "/partner/v1/spaces",
  requireApiKey,
  requireScope("spaces:read"),
  c.partnerListSpaces
);
router.get(
  "/partner/v1/bookings/:id",
  requireApiKey,
  requireScope("bookings:read"),
  c.partnerGetBooking
);

// Admin Identity routes
router.post(
  "/admin/users/:userId/force-logout",
  verifyToken,
  requireAdmin,
  c.adminForceLogout
);

module.exports = router;
