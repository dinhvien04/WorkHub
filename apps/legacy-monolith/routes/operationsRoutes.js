"use strict";

const express = require("express");
const {
  verifyToken,
  authorizeRole,
  requireAdmin,
  requireVerifiedHost,
} = require("../middlewares/authMiddleware");
const { rumLimiter } = require("../middlewares/rateLimiters");

const c = require("../controllers/operationsController");
const router = express.Router();

const host = [verifyToken, authorizeRole("host"), requireVerifiedHost];

// General / Customer Operations routes
router.post("/bookings/:bookingId/disputes", verifyToken, c.openDispute);
router.get("/disputes", verifyToken, c.listDisputes);
router.post("/support/tickets", verifyToken, c.createTicket);
router.get("/support/tickets", verifyToken, c.listTickets);

router.post("/fraud/preview", verifyToken, c.fraudPreview);
router.post("/rum", rumLimiter, c.rumBeacon);

// Host Operations routes
router.get("/host/reports/advanced", ...host, c.hostAdvancedReport);

// Admin Operations routes
router.put(
  "/admin/disputes/:disputeId/resolve",
  verifyToken,
  requireAdmin,
  c.resolveDispute
);
router.get("/admin/system-health", verifyToken, requireAdmin, c.systemHealth);

router.get("/admin/seo/redirects", verifyToken, requireAdmin, c.listSeoRedirects);
router.put("/admin/seo/redirects", verifyToken, requireAdmin, c.upsertSeoRedirect);
router.delete("/admin/seo/redirects/:id", verifyToken, requireAdmin, c.deleteSeoRedirect);
router.patch("/admin/seo/redirects/:id", verifyToken, requireAdmin, c.toggleSeoRedirect);

router.get("/admin/dead-letters", verifyToken, requireAdmin, c.listDeadLetters);
router.post("/admin/dead-letters/:id/replay", verifyToken, requireAdmin, c.replayDeadLetter);
router.delete("/admin/dead-letters/:id", verifyToken, requireAdmin, c.discardDeadLetter);

module.exports = router;
