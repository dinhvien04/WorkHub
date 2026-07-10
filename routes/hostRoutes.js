const express = require('express');
const router = express.Router();

// Import Controller
const hostController = require('../controllers/hostController');

// Import Middleware bảo mật và Upload ảnh
const { verifyToken, authorizeRole, requireVerifiedHost } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/upload');
const paymentService = require('../services/paymentService');
const ledgerService = require('../services/ledgerService');
const asyncHandler = require('../utils/asyncHandler');

// Host API: authenticated + role host + IsVerified
router.use(verifyToken, authorizeRole('host'), requireVerifiedHost);

// ====================================================================
// 1. API HỒ SƠ & THỐNG KÊ (HEAD)
// ====================================================================
router.get('/dashboard-stats', hostController.getDashboardStatsAPI);
router.get('/profile', hostController.getProfileAPI);
// Cập nhật profile (vẫn dùng single LogoFile vì logo chỉ có 1 ảnh)
router.put('/profile', upload.single('LogoFile'), hostController.updateProfileAPI);

// ====================================================================
// 2. QUẢN LÝ CƠ SỞ (BRANCHES) - Tích hợp upload nhiều ảnh của Minh-Hiếu
// ====================================================================
router.get('/branches', hostController.getHostBranches);
router.post('/branches', upload.array('image', 10), hostController.createBranch);
router.put('/branches/:branchId', upload.array('image', 10), hostController.updateBranch);
router.post('/branches/:branchId/delete-image', hostController.deleteBranchImage);

// ====================================================================
// 3. QUẢN LÝ KHÔNG GIAN (SPACES) - Tích hợp upload nhiều ảnh của Minh-Hiếu
// ====================================================================
router.get('/spaces', hostController.getHostSpaces);
router.get('/branches/:branchId/spaces', hostController.getBranchSpaces);
router.post('/branches/:branchId/spaces', upload.array('image', 10), hostController.createSpace);
router.put('/spaces/:spaceId', upload.array('image', 10), hostController.updateSpace);
router.post('/spaces/:spaceId/delete-image', hostController.deleteSpaceImage);

// Route gộp đặc biệt cho Wizard thêm mới (Của HEAD) - Đổi thành /wizard để không bị trùng
router.post('/branches/wizard', upload.array('image', 10), hostController.createBranchAndSpaces);

// ====================================================================
// 4. QUẢN LÝ ĐƠN HÀNG (BOOKINGS) (HEAD)
// ====================================================================
router.get('/bookings', hostController.getHostBookings);
router.put('/bookings/:bookingId/confirm', hostController.confirmBooking);
router.put('/bookings/:bookingId/checkin', hostController.checkinBooking);
router.put('/bookings/:bookingId/cancel', hostController.cancelBooking);

// Payment verify / reject
router.put(
  '/payments/:paymentId/verify',
  asyncHandler(async (req, res) => {
    const payment = await paymentService.verifyPayment(req.user.userId, req.params.paymentId);
    await ledgerService.postEntry({
      hostId: req.user.userId,
      customerId: payment.CustomerID,
      bookingId: payment.BookingID,
      paymentId: payment._id,
      type: 'payment',
      amount: payment.Amount,
      direction: 'credit',
      description: `Payment ${payment.TransactionCode}`,
      idempotencyKey: `ledger-pay-${payment._id}`,
    });
    res.json({ message: 'Đã xác minh thanh toán.', payment });
  })
);
router.put(
  '/payments/:paymentId/reject',
  asyncHandler(async (req, res) => {
    const payment = await paymentService.rejectPayment(
      req.user.userId,
      req.params.paymentId,
      req.body?.reason
    );
    res.json({ message: 'Đã từ chối thanh toán.', payment });
  })
);

module.exports = router;