'use strict';

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, requireAdmin } = require('../middlewares/authMiddleware');
const { requireAdmin2faIfEnabled } = require('../middlewares/admin2fa');

router.use(verifyToken, requireAdmin, requireAdmin2faIfEnabled);

router.get('/stats', adminController.getAdminDashboard);
router.get('/metrics/conversion', adminController.getConversionMetrics);
router.get('/users', adminController.listUsers);
router.patch('/users/:id/toggle-status', adminController.toggleUserStatus);

router.get('/pending-hosts', adminController.getPendingHosts);
router.patch('/hosts/:id/verify', adminController.verifyHost);

router.get('/activity-logs', adminController.getActivityLogs);
router.get('/entity-detail', adminController.getEntityDetail);

router.get('/listings/flagged', adminController.listFlaggedListings);
router.post('/listings/moderate', adminController.moderateListing);

module.exports = router;
