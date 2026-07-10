const express = require('express');

// Khai báo gộp TẤT CẢ các hàm từ authController
const {
    registerUser,
    loginUser,
    logoutUser,
    changePassword,
    forgotPassword,
    resetPassword
} = require('../controllers/authController');

const authMiddleware = require('../middlewares/authMiddleware');
const upload = require('../middlewares/upload');

const router = express.Router();

// ================= LUỒNG XÁC THỰC CƠ BẢN =================
router.post('/register', upload.single('verificationDocument'), registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.post('/change-password', authMiddleware.verifyToken, changePassword);

// ================= LUỒNG QUÊN MẬT KHẨU MÔ PHỎNG =================
router.post('/forgot-password', forgotPassword); // Bước 1: Gửi email -> Sinh OTP in ra console
router.post('/reset-password', resetPassword);   // Bước 2: Kiểm tra OTP -> Đổi mật khẩu mới

module.exports = router;
