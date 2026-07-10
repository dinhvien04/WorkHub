'use strict';

const express = require('express');
const { verifyToken, authorizeRole, requireAdmin, requireVerifiedHost } = require('../middlewares/authMiddleware');
const c = require('../controllers/platformController');

const router = express.Router();

// Public search
router.get('/search', c.search);
router.get('/search/facets', c.searchFacets);
router.get('/featured', c.featured);
router.get('/autocomplete', c.autocomplete);
router.get('/cms', c.listCms);
router.get('/cms/:slug', c.getCms);
router.get('/flags', c.flags);
router.get('/membership/plans', c.listPlans);
router.post('/pricing/quote', c.quote);

// Customer authenticated
router.get('/bookings/:bookingId/reschedule-preview', verifyToken, c.reschedulePreview);
router.post('/bookings/:bookingId/reschedule-preview', verifyToken, c.reschedulePreview);
router.put('/bookings/:bookingId/reschedule', verifyToken, c.reschedule);
router.post('/bookings/:bookingId/refunds', verifyToken, c.requestRefund);
router.post('/bookings/:bookingId/disputes', verifyToken, c.openDispute);
router.get('/disputes', verifyToken, c.listDisputes);
router.post('/support/tickets', verifyToken, c.createTicket);
router.get('/support/tickets', verifyToken, c.listTickets);
router.get('/membership/me', verifyToken, authorizeRole('customer'), c.myMembership);
router.get('/membership/credits', verifyToken, authorizeRole('customer'), c.myCreditLedger);
router.post('/staff/accept', verifyToken, c.acceptStaffInvite);

// Host
const host = [verifyToken, authorizeRole('host'), requireVerifiedHost];
router.get('/host/staff', ...host, c.listStaff);
router.post('/host/staff/invite', ...host, c.inviteStaff);
router.delete('/host/staff/:staffId', ...host, c.revokeStaff);
const { requireFinanceAccess } = require('../middlewares/hostPermission');
router.get('/host/balance', ...host, requireFinanceAccess(), c.hostBalance);
router.get('/host/ledger', ...host, requireFinanceAccess(), c.hostLedger);
router.get('/host/addons', ...host, c.listAddOns);
router.post('/host/addons', ...host, c.createAddOn);
router.get('/host/blackouts', ...host, c.listBlackouts);
router.post('/host/blackouts', ...host, c.createBlackout);
router.delete('/host/blackouts/:blackoutId', ...host, c.deleteBlackout);
router.post('/host/spaces/bulk', ...host, c.bulkSpaces);
router.put('/host/branches/:branchId/status', ...host, c.setBranchStatusHost);
router.put('/host/branches/:branchId/publish', ...host, c.setBranchPublishHost);
router.get('/host/pricing-rules', ...host, c.listPricingRules);
router.post('/host/pricing-rules', ...host, c.createPricingRule);
router.post('/host/pricing-rules/preview', ...host, c.previewPricingRule);
router.put('/host/pricing-rules/:ruleId/publish', ...host, c.publishPricingRule);
router.post('/host/spaces/bulk-status', ...host, c.bulkSpaceStatus);
router.get('/host/reception/today', ...host, c.receptionToday);
router.put('/host/bookings/:bookingId/checkout', ...host, c.checkout);
router.post('/host/incidents', ...host, c.createIncident);
router.put('/host/payments/:paymentId/verify-ledger', ...host, c.verifyPaymentWithLedger);
router.put('/host/refunds/:refundId/process', ...host, c.processRefund);

// Admin
router.put('/admin/disputes/:disputeId/resolve', verifyToken, requireAdmin, c.resolveDispute);
router.put('/admin/refunds/:refundId/process', verifyToken, requireAdmin, c.processRefund);
router.post('/admin/cms', verifyToken, requireAdmin, c.upsertCms);
router.get('/admin/flags', verifyToken, requireAdmin, c.adminListFlags);
router.put('/admin/flags', verifyToken, requireAdmin, c.adminUpsertFlag);

module.exports = router;
