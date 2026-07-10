'use strict';

const express = require('express');
const {
  getHomePage,
  searchBranches,
  detailPage,
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
  getPaymentHistoryPage,
} = require('../controllers/customerController');

const { verifyToken, authorizeRole } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/upload');
const { bookingLimiter, paymentLimiter } = require('../middlewares/rateLimiters');

const router = express.Router();

// ==========================================
// 1. PAGE ROUTES (EJS)
// ==========================================
router.get('/', getHomePage);
router.get('/search', searchBranches);
router.get('/detail', detailPage);

router.get('/payment', (req, res) => {
  res.render('customer/payment', { scripts: '<script src="/js/customer-main.js"></script>' });
});
router.get('/history', (req, res) => {
  res.render('customer/history', {
    scripts:
      '<script src="/js/customer-main.js"></script><script src="/js/customer-history.js"></script>',
  });
});
router.get('/payment_history', verifyToken, getPaymentHistoryPage);
router.get('/profile', (req, res) => {
  res.render('customer/profile', { scripts: '<script src="/js/customer-main.js"></script>' });
});

// ==========================================
// 2. PUBLIC API
// ==========================================
router.post('/bookings/check-availability', checkAvailability);
router.get('/branch/:branchId/reviews', getBranchReviews);
router.get('/bookings/:bookingId/review', getReview);

// ==========================================
// 3. PRIVATE API — /me/* (preferred)
// ==========================================
const protectCustomer = [verifyToken, authorizeRole('customer')];

router.get('/me/profile', ...protectCustomer, getMyProfile);
router.put('/me/profile', ...protectCustomer, upload.single('customerAvatar'), updateMyProfile);
router.get('/me/bookings', ...protectCustomer, getCustomerBookings);
router.post('/me/bookings', ...protectCustomer, bookingLimiter, createBooking);
router.post('/me/bookings/:bookingId/review', ...protectCustomer, submitReview);
router.put('/me/bookings/:bookingId/cancel', ...protectCustomer, cancelBooking);
router.put('/me/bookings/:bookingId/pay', ...protectCustomer, paymentLimiter, payRemainder);
router.post('/me/booking/confirm', ...protectCustomer, paymentLimiter, confirmPayment);
// alias used by frontend
router.post('/booking/confirm', ...protectCustomer, paymentLimiter, confirmPayment);

// ==========================================
// 4. DEPRECATED :userId routes — self-only, ownership enforced in controller
// ==========================================
router.post('/:userId/bookings', ...protectCustomer, bookingLimiter, createBooking);
router.get('/:userId/profile', ...protectCustomer, getCustomerProfile);
router.put('/:userId/profile', ...protectCustomer, updateCustomerProfile);
router.get('/:userId/bookings', ...protectCustomer, getCustomerBookings);
router.post('/:userId/bookings/:bookingId/review', ...protectCustomer, submitReview);
router.put('/:userId/bookings/:bookingId/cancel', ...protectCustomer, cancelBooking);
router.put('/:userId/bookings/:bookingId/pay', ...protectCustomer, paymentLimiter, payRemainder);

module.exports = router;
