const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema({
    // 1. LIÊN KẾT (RELATIONSHIPS)
    HostID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Liên kết tới tài khoản Host
        required: true,
        index: true // Tối ưu cho API lấy danh sách chi nhánh của 1 Host
    },

    // 2. THÔNG TIN CƠ BẢN VÀ ĐỊA CHỈ
    Name: {
        type: String,
        required: true,
        trim: true
    },
    Address: { // Địa chỉ chi tiết (Số nhà, tên đường)
        type: String,
        required: true,
        trim: true
    },
    District: { // Phục vụ cho bộ lọc tìm kiếm nhanh trên giao diện
        type: String,
        trim: true,
        index: true
    },
    City: { // Phục vụ cho bộ lọc tìm kiếm nhanh
        type: String,
        trim: true,
        index: true
    },
    Description: {
        type: String,
        trim: true,
        default: ""
    },
    Images: { // Ảnh tổng quan của chi nhánh (Mặt tiền, khu vực sinh hoạt chung)
        type: [String],
        default: []
    },

    // 3. THỜI GIAN HOẠT ĐỘNG
    OpeningTime: {
        type: String,
        required: true,
        trim: true,
        match: /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/ // Chuẩn định dạng HH:mm
    },
    ClosingTime: {
        type: String,
        required: true,
        trim: true,
        match: /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/
    },

    // 4. CHÍNH SÁCH VÀ ĐÁNH GIÁ
    DepositPercentage: { // Tỷ lệ cọc (0.3 = 30%)
        type: Number,
        min: 0,
        max: 1,
        default: 0.3 // Mặc định cọc 30%
    },
    RatingAvg: { // Cache điểm đánh giá trung bình của toàn bộ các Space trong chi nhánh
        type: Number,
        min: 0,
        max: 5,
        default: 0
    },

    // 5. TRẠNG THÁI HOẠT ĐỘNG
    Status: {
        type: String,
        enum: ['active', 'inactive', 'maintenance'],
        default: 'active',
        index: true
        
    }

}, {
    collection: 'branches',
    timestamps: true // Tự động bật đầy đủ cả CreatedAt và UpdatedAt
});

module.exports = mongoose.model('Branch', branchSchema);