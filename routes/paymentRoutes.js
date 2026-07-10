'use strict';

const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const { parsePagination, paginationMeta } = require('../utils/pagination');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /host/payments — page render with host-scoped payments only.
 * Requires requireHostPage middleware (req.currentUser / req.user).
 */
router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    if (!req.currentUser && !req.user) {
      return res.redirect('/login');
    }

    const hostId = (req.user && req.user.userId) || req.currentUser._id;
    const { page, limit } = parsePagination(req.query, { page: 1, limit: 50, maxLimit: 100 });
    const status = req.query.status || undefined;

    const { payments, total } = await paymentService.listHostPayments(hostId, {
      page,
      limit,
      status,
    });

    // Mask sensitive bank fields if populated later
    const safePayments = payments.map((p) => {
      if (p.CustomerID && p.CustomerID.PasswordHash) delete p.CustomerID.PasswordHash;
      return p;
    });

    return res.render('host/payments', {
      currentUser: req.currentUser,
      payments: safePayments,
      pagination: paginationMeta(total, page, limit),
      scripts: '<script src="/js/host-spaces.js"></script>',
    });
  })
);

module.exports = router;
