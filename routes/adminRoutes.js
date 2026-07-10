'use strict';

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, requireAdmin } = require('../middlewares/authMiddleware');
const { requireAdmin2faIfEnabled } = require('../middlewares/admin2fa');

router.use(verifyToken, requireAdmin, requireAdmin2faIfEnabled);

router.get('/stats', adminController.getAdminDashboard);
router.get('/metrics/conversion', adminController.getConversionMetrics);
router.get('/metrics/funnel', adminController.getConversionMetrics);
router.get('/alerts', adminController.getAlerts);
router.get('/finance/recon-export', adminController.getPaymentReconExport);
router.get('/users', adminController.listUsers);
router.patch('/users/:id/toggle-status', adminController.toggleUserStatus);

router.get('/pending-hosts', adminController.getPendingHosts);
router.get('/hosts/verification', adminController.listHostsVerification);
router.patch('/hosts/:id/verify', adminController.verifyHost);
router.patch('/hosts/:id/verification', adminController.setHostVerification);
router.post('/hosts/:id/document-access', adminController.mintHostDocAccess);
router.get('/hosts/:id/document', adminController.redeemHostDocAccess);

router.get('/activity-logs', adminController.getActivityLogs);
router.get('/entity-detail', adminController.getEntityDetail);

router.get('/listings/flagged', adminController.listFlaggedListings);
router.post('/listings/moderate', adminController.moderateListing);

module.exports = router;
