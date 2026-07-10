const mongoose = require('mongoose');

const hostProfileSchema = new mongoose.Schema({
    // 1. LIÊN KẾT 1-1 VỚI BẢNG USER
    UserID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true // Chốt chặn: 1 User chỉ có 1 Profile Host
    },

    // 2. THÔNG TIN DOANH NGHIỆP HIỂN THỊ TRÊN APP
    CompanyName: {
        type: String,
        trim: true,
        required: true
    },
    Logo: { // Hình ảnh đại diện thương hiệu của Host
        type: String,
        default: ""
    },
    Hotline: {
        type: String,
        trim: true,
        required: true,
        index: true // Giúp Admin dễ dàng support qua số điện thoại
    },

    // 3. THÔNG TIN PHÁP LÝ & KIỂM DUYỆT (ADMIN QUẢN LÝ)
    TaxCode: {
        type: String,
        trim: true,
        unique: true, // 1 Doanh nghiệp không được tạo nhiều tài khoản
        sparse: true  // Cho phép null nếu lúc mới tạo tài khoản họ chưa kịp nhập
    },
    VerificationDocument: { 
        type: String, // Link file Giấy phép kinh doanh (có thể áp dụng hash SHA-256 để verify)
        default: ""
    },
    IsVerified: { 
        type: Boolean, // Cờ kiểm duyệt: True thì Host mới được phép tạo Space
        default: false,
        index: true
    },

    // 4. THÔNG TIN TÀI CHÍNH (ĐỂ HỆ THỐNG TRẢ TIỀN)
    BankName: {
        type: String,
        trim: true,
        required: true // Ràng buộc bắt buộc
    },
    BankNumber: {
        type: String,
        trim: true,
        required: true // Ràng buộc bắt buộc
    }

}, {
    collection: 'host_profiles',
    timestamps: true
});

module.exports = mongoose.model('HostProfile', hostProfileSchema);