const mongoose = require('mongoose');

const customerProfileSchema = new mongoose.Schema({
    // 1. LIÊN KẾT 1-1 VỚI BẢNG USER
    UserID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true // CỰC KỲ QUAN TRỌNG: Đảm bảo 1 User chỉ có duy nhất 1 Profile
    },
    Avatar: { // Ảnh đại diện người dùng (URL Cloudinary/S3)
        type: String,
        default: ""
    },
    Phone: {
        type: String,
        trim: true,
        index: true // Đặt Index để Admin dễ dàng tìm kiếm khách hàng qua số điện thoại
    },


    // 4. THÔNG TIN TÀI CHÍNH (Phục vụ cho việc Host hoàn cọc)
    BankName: {
        type: String,
        trim: true,
        default: ""
    },
    BankNumber: {
        type: String,
        trim: true,
        default: ""
    }

}, {
    collection: 'customer_profiles',
    timestamps: true
});

module.exports = mongoose.model('CustomerProfile', customerProfileSchema);