const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    // 1. LIÊN KẾT (RELATIONSHIPS)
    CustomerID: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },
    SpaceID: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Space', 
        required: true,
        index: true 
    },
    HostID: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true // Phục vụ cho API thống kê, lấy list booking của Host
    },

    // 2. THỜI GIAN (TIME) - Chuẩn Date để truy vấn mạnh mẽ
    StartTime: { type: Date, required: true },
    EndTime: { type: Date, required: true },

    // 3. TÀI CHÍNH (FINANCE) - Lưu số tiền thực tế (VND)
    TotalAmount: { type: Number, required: true, min: 0 },
    DepositAmount: { type: Number, required: true, min: 0 }, // Tiền cọc (nếu thanh toán 100% thì Deposit = Total)

    // 4. TRẠNG THÁI VÀ GHI CHÚ
    Status: { 
        type: String, 
        enum: ['pending', 'confirmed','in-use', 'completed', 'cancelled'], 
        default: 'pending',
        index: true 
    },
    Note: { type: String, default: "" }

}, { 
    // Tự động tạo CreateAt và UpdateAt
    timestamps: true 
});

// 5. CHỈ MỤC PHỨC HỢP (COMPOSITE INDEX)
// Đây là "vũ khí bí mật" giúp API kiểm tra trùng lịch chạy nhanh gấp 10 lần
bookingSchema.index({ SpaceID: 1, StartTime: 1, EndTime: 1 });

module.exports = mongoose.model('Booking', bookingSchema);

