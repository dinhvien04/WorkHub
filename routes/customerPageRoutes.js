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

function pageScripts(res, files) {
  return res.locals.scriptsFrom ? res.locals.scriptsFrom(files) : files.map((f) => `<script src="${f}"></script>`).join('');
}

router.get('/', getHomePage);
router.get('/search', searchBranches);
router.get('/detail', detailPage);

router.get('/payment', (req, res) => {
  res.render('customer/payment', {
    pageTitle: 'Thanh toán — WorkHub',
    scripts: pageScripts(res, ['/js/customer-main.js']),
  });
});
router.get('/history', (req, res) => {
  res.render('customer/history', {
    pageTitle: 'Lịch sử đặt chỗ — WorkHub',
    scripts: pageScripts(res, ['/js/customer-main.js', '/js/customer-history.js']),
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
    pageTitle: 'Hồ sơ — WorkHub',
    scripts: pageScripts(res, ['/js/customer-main.js']),
  });
});

module.exports = router;
