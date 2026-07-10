'use strict';

const express = require('express');
const {
  getHomePage,
  searchBranches,
  detailPage,
  getPaymentHistoryPage,
} = require('../controllers/customerController');
const { verifyToken, authorizeRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// Public guest pages
router.get('/', getHomePage);
router.get('/search', searchBranches);
router.get('/detail', detailPage);

// Customer pages (auth checked client-side for UX; payment_history needs token)
router.get('/payment', (req, res) => {
  res.render('customer/payment', {
    scripts: '<script src="/js/customer-main.js"></script>',
  });
});
router.get('/history', (req, res) => {
  res.render('customer/history', {
    scripts:
      '<script src="/js/customer-main.js"></script><script src="/js/customer-history.js"></script>',
  });
});
router.get(
  '/payment_history',
  verifyToken,
  authorizeRole('customer'),
  getPaymentHistoryPage
);
router.get('/profile', (req, res) => {
  res.render('customer/profile', {
    scripts: '<script src="/js/customer-main.js"></script>',
  });
});

module.exports = router;
