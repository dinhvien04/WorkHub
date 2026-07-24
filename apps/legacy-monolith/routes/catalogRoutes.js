"use strict";

const express = require("express");
const {
  verifyToken,
  authorizeRole,
  requireAdmin,
  requireVerifiedHost,
} = require("../middlewares/authMiddleware");
const { reviewReportLimiter } = require("../middlewares/rateLimiters");

const c = require("../controllers/catalogController");
const router = express.Router();

const host = [verifyToken, authorizeRole("host"), requireVerifiedHost];

// General / Customer Catalog routes
router.get("/search", c.search);
router.get("/search/facets", c.searchFacets);
router.get("/featured", c.featured);
router.get("/autocomplete", c.autocomplete);

router.post(
  "/reviews/:reviewId/report",
  verifyToken,
  reviewReportLimiter,
  c.reportReview
);
router.get("/public/hosts/:hostId", c.publicHostProfile);

// Host Catalog routes
router.put("/host/branches/:branchId/status", ...host, c.setBranchStatusHost);
router.put("/host/branches/:branchId/publish", ...host, c.setBranchPublishHost);
router.get("/host/reviews", ...host, c.listHostReviews);
router.post("/host/reviews/:reviewId/reply", ...host, c.hostReplyReview);

// Admin Catalog routes
router.get("/admin/reviews", verifyToken, requireAdmin, c.listAdminReviews);
router.put(
  "/admin/reviews/:reviewId/moderate",
  verifyToken,
  requireAdmin,
  c.moderateReview
);

module.exports = router;
