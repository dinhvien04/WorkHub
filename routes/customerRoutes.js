const express = require('express');

// Import toàn bộ các hàm từ Controller (Đã hợp nhất BẠN và NA)
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
    getPaymentHistoryPage
} = require('../controllers/customerController');

// Import Middleware bảo mật và Upload ảnh
const { verifyToken, authorizeRole } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/upload');

const router = express.Router();

// ==========================================
// 1. PAGE ROUTES (Render EJS - CỦA BẠN)
// Tuyệt đối KHÔNG DÙNG router.use(verifyToken) ở đầu file 
// vì sẽ làm chặn luôn trang chủ của Khách vãng lai (Guest).
// ==========================================
router.get('/', getHomePage);
router.get('/search', searchBranches);
router.get('/detail', detailPage);

router.get('/payment', (req, res) => {
    res.render('customer/payment', { scripts: '<script src="/js/customer-main.js"></script>' });
});
router.get('/history', (req, res) => {
    res.render('customer/history', { scripts: '<script src="/js/customer-main.js"></script><script src="/js/customer-history.js"></script>' });
});
router.get('/payment_history', verifyToken, getPaymentHistoryPage);
router.get('/profile', (req, res) => {
    res.render('customer/profile', { scripts: '<script src="/js/customer-main.js"></script>' });
});

// ==========================================
// 2. PUBLIC API ROUTES
// Các API dùng để tra cứu trước khi đăng nhập
// ==========================================
router.post('/bookings/check-availability', checkAvailability);
router.get('/branch/:branchId/reviews', getBranchReviews);
router.get('/bookings/:bookingId/review', getReview);

// ==========================================
// 3. PRIVATE API ROUTES (BẮT BUỘC CÓ TOKEN)
// Gán trực tiếp lớp bảo vệ vào từng Route
// ==========================================
const protectCustomer = [verifyToken, authorizeRole('customer')];

// --- Thông tin cá nhân của chính mình (Của NA) ---
router.get('/me/profile', verifyToken, getMyProfile);
router.put('/me/profile', verifyToken, upload.single('customerAvatar'), updateMyProfile);

// --- API Đặt chỗ và Xác nhận thanh toán ---
router.post('/:userId/bookings', verifyToken, createBooking); 
router.post('/booking/confirm', verifyToken, confirmPayment);

// --- Các API Quản lý cá nhân, Đơn hàng theo UserId (Tham chiếu chéo/Admin) ---
router.get('/:userId/profile', protectCustomer, getCustomerProfile);
router.put('/:userId/profile', protectCustomer, updateCustomerProfile);
router.get('/:userId/bookings', protectCustomer, getCustomerBookings);

// --- Hành động với đơn hàng ---
router.post('/:userId/bookings/:bookingId/review', protectCustomer, submitReview);
router.put('/:userId/bookings/:bookingId/cancel', protectCustomer, cancelBooking);
router.put('/:userId/bookings/:bookingId/pay', protectCustomer, payRemainder);

module.exports = router;