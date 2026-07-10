const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // 1. THÔNG TIN XÁC THỰC (AUTHENTICATION)
    Email: {
        type: String,
        required: true,
        unique: true, // Chống đăng ký trùng email
        trim: true,
        lowercase: true,
        index: true // CỰC KỲ QUAN TRỌNG: API Đăng nhập luôn tìm kiếm bằng Email, phải có Index!
    },
    PasswordHash: {
        type: String,
        required: true
    },
    // 2. THÔNG TIN CÁ NHÂN CƠ BẢN
    FullName: {
        type: String,
        trim: true,
        required: true
    },

    // 2. PHÂN QUYỀN VÀ TRẠNG THÁI (AUTHORIZATION & STATUS)
    Role: {
        type: String,
        enum: ['customer', 'host', 'admin'],
        default: 'customer',
        index: true // Hỗ trợ Admin lọc danh sách người dùng theo vai trò nhanh hơn
    },
    Status: {
        type: String,
        enum: ['active', 'inactive', 'banned'], // Thêm 'banned' để chặn user vi phạm
        default: 'inactive' // Mặc định inactive cho đến khi xác thực qua Email (OTP/Link)
    }

}, {
    collection: 'users',
    timestamps: true // Tự động sinh ra CreatedAt và UpdatedAt
});

module.exports = mongoose.model('User', userSchema);