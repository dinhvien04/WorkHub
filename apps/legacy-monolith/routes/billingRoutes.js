"use strict";

const express = require("express");
const {
  verifyToken,
  authorizeRole,
  requireAdmin,
  requireVerifiedHost,
} = require("../middlewares/authMiddleware");
const { requireFinanceAccess } = require("../middlewares/hostPermission");
const env = require("../config/env");

const c = require("../controllers/billingController");
const router = express.Router();

const host = [verifyToken, authorizeRole("host"), requireVerifiedHost];

// General / Customer Billing routes
router.post("/bookings/:bookingId/refunds", verifyToken, c.requestRefund);
router.post("/pricing/quote", c.quote);
router.get("/refunds", verifyToken, c.listRefunds);

router.get("/gateway/providers", c.listGatewayProviders);
router.post(
  "/gateway/checkout",
  verifyToken,
  authorizeRole("customer"),
  c.createCheckout
);
router.get(
  "/gateway/sessions/:sessionId",
  verifyToken,
  authorizeRole("customer"),
  c.getGatewaySession
);
if (!env.isProduction && env.ALLOW_MOCK_COMPLETE) {
  router.post(
    "/gateway/sessions/:sessionId/mock-complete",
    verifyToken,
    authorizeRole("customer"),
    c.mockCompleteGateway
  );
}

router.get("/membership/plans", c.listPlans);
router.get(
  "/membership/me",
  verifyToken,
  authorizeRole("customer"),
  c.myMembership
);
router.get(
  "/membership/credits",
  verifyToken,
  authorizeRole("customer"),
  c.myCreditLedger
);
router.post(
  "/membership/subscribe",
  verifyToken,
  authorizeRole("customer"),
  c.subscribe
);

router.get("/jobs/me", verifyToken, c.listMyJobs);
router.get("/jobs/:jobId", verifyToken, c.getJobStatus);
router.get("/jobs/:jobId/download", verifyToken, c.downloadJobFile);
router.post("/jobs/:jobId/retry", verifyToken, c.retryJob);

// Host Billing routes
router.get("/host/balance", ...host, requireFinanceAccess(), c.hostBalance);
router.get("/host/ledger", ...host, requireFinanceAccess(), c.hostLedger);
router.get("/host/pricing-rules", ...host, c.listPricingRules);
router.post("/host/pricing-rules", ...host, c.createPricingRule);
router.post("/host/pricing-rules/preview", ...host, c.previewPricingRule);
router.put(
  "/host/pricing-rules/:ruleId/publish",
  ...host,
  c.publishPricingRule
);
router.put(
  "/host/payments/:paymentId/verify-ledger",
  ...host,
  c.verifyPaymentWithLedger
);
router.put("/host/refunds/:refundId/process", ...host, c.processRefund);
router.post("/host/payouts", ...host, c.requestPayout);
router.get("/host/payouts", ...host, c.listPayouts);
router.get("/host/refunds", ...host, c.listRefunds);

router.get("/host/ledger/export.csv", ...host, c.exportLedgerCsv);
router.post("/host/exports/ledger", ...host, c.enqueueLedgerExport);
router.post("/host/exports/bookings", ...host, c.enqueueBookingsExport);

// Admin Billing routes
router.put(
  "/admin/refunds/:refundId/process",
  verifyToken,
  requireAdmin,
  c.processRefund
);
router.get("/admin/payouts", verifyToken, requireAdmin, c.adminListPayouts);
router.put(
  "/admin/payouts/:payoutId/process",
  verifyToken,
  requireAdmin,
  c.adminProcessPayout
);
router.get("/admin/refunds", verifyToken, requireAdmin, c.listRefunds);

module.exports = router;
