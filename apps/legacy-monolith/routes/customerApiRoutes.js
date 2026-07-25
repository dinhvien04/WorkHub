'use strict';

const express = require('express');
const {
  getCustomerProfile,
  updateCustomerProfile,
  getMyProfile,
  updateMyProfile,
  getCustomerBookings,
  createBooking,
  confirmPayment,
  checkAvailability,
  cancelBooking,
  payRemainder,
  submitReview,
  getReview,
  getBranchReviews,
  getMyBookingById,
} = require('../controllers/customerController');

const { verifyToken, authorizeRole } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/upload');
const { bookingLimiter, paymentLimiter } = require('../middlewares/rateLimiters');

const router = express.Router();

// Public read APIs (no CSRF for GET)
router.get('/bookings/availability', checkAvailability);
router.get('/branch/:branchId/reviews', getBranchReviews);
router.get('/bookings/:bookingId/review', getReview);

const protectCustomer = [verifyToken, authorizeRole('customer')];

// Preferred /me routes
router.get('/me/profile', ...protectCustomer, getMyProfile);
router.put('/me/profile', ...protectCustomer, upload.single('customerAvatar'), updateMyProfile);
router.get('/me/bookings', ...protectCustomer, getCustomerBookings);
router.get('/me/bookings/:bookingId', ...protectCustomer, getMyBookingById);
router.post('/me/bookings', ...protectCustomer, bookingLimiter, createBooking);
router.post('/me/bookings/:bookingId/review', ...protectCustomer, submitReview);
router.put('/me/bookings/:bookingId/cancel', ...protectCustomer, cancelBooking);
router.put('/me/bookings/:bookingId/pay', ...protectCustomer, paymentLimiter, payRemainder);
router.post('/me/booking/confirm', ...protectCustomer, paymentLimiter, confirmPayment);

// Deprecated self-only aliases under /api/customers only
function deprecationWarning(req, res, next) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Sat, 01 Jan 2027 00:00:00 GMT');
  next();
}

router.post('/:userId/bookings', deprecationWarning, ...protectCustomer, bookingLimiter, createBooking);
router.get('/:userId/profile', deprecationWarning, ...protectCustomer, getCustomerProfile);
router.put('/:userId/profile', deprecationWarning, ...protectCustomer, updateCustomerProfile);
router.get('/:userId/bookings', deprecationWarning, ...protectCustomer, getCustomerBookings);
router.post(
  '/:userId/bookings/:bookingId/review',
  deprecationWarning,
  ...protectCustomer,
  submitReview
);
router.put(
  '/:userId/bookings/:bookingId/cancel',
  deprecationWarning,
  ...protectCustomer,
  cancelBooking
);
router.put(
  '/:userId/bookings/:bookingId/pay',
  deprecationWarning,
  ...protectCustomer,
  paymentLimiter,
  payRemainder
);

module.exports = router;
