'use strict';

const express = require('express');
const { verifyToken, authorizeRole, requireVerifiedHost } = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/meExtraController');
const calendarService = require('../services/calendarService');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Favorites + notifications for any authenticated user
router.get('/favorites', verifyToken, ctrl.listFavorites);
router.post('/favorites', verifyToken, authorizeRole('customer'), ctrl.addFavorite);
router.delete('/favorites/:branchId', verifyToken, authorizeRole('customer'), ctrl.removeFavorite);
router.post('/favorites/merge', verifyToken, authorizeRole('customer'), ctrl.mergeFavorites);

router.get('/notifications', verifyToken, ctrl.listNotifications);
router.get('/notifications/unread-count', verifyToken, ctrl.notificationUnreadCount);
router.post('/notifications/read-all', verifyToken, ctrl.markAllNotificationsRead);
router.patch('/notifications/:id/read', verifyToken, ctrl.markNotificationRead);
router.delete('/notifications/:id', verifyToken, ctrl.deleteNotification);

router.post('/coupons/preview', verifyToken, authorizeRole('customer'), ctrl.previewCoupon);

router.get(
  '/bookings/:bookingId/messages',
  verifyToken,
  authorizeRole('customer', 'host', 'admin'),
  ctrl.listMessages
);
router.post(
  '/bookings/:bookingId/messages',
  verifyToken,
  authorizeRole('customer', 'host', 'admin'),
  ctrl.sendMessage
);
router.get('/bookings/:bookingId/ics', verifyToken, authorizeRole('customer'), ctrl.downloadIcs);

// Privacy
router.get('/privacy/export', verifyToken, ctrl.exportMyData);
router.post('/privacy/delete-request', verifyToken, ctrl.requestDeleteAccount);

// Host calendar
router.get(
  '/host/calendar',
  verifyToken,
  authorizeRole('host'),
  requireVerifiedHost,
  asyncHandler(async (req, res) => {
    const data = await calendarService.getHostCalendar({
      hostId: req.user.userId,
      from: req.query.from,
      to: req.query.to,
      branchId: req.query.branchId || null,
      spaceId: req.query.spaceId || null,
    });
    res.json(data);
  })
);

module.exports = router;
