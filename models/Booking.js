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
        enum: [
          'draft',
          'hold',
          'pending',
          'awaiting_payment',
          'payment_under_review',
          'confirmed',
          'in-use',
          'completed',
          'cancel_requested',
          'cancelled',
          'rejected',
          'expired',
        ], 
        default: 'pending',
        index: true 
    },
    Note: { type: String, default: "" },
    // Temporary hold before payment (minutes)
    HoldExpiresAt: { type: Date, default: null, index: true },
    CouponCode: { type: String, default: '' },
    DiscountAmount: { type: Number, default: 0, min: 0 },
    // Immutable snapshot for history/receipts
    Snapshot: {
      BranchName: { type: String, default: '' },
      SpaceName: { type: String, default: '' },
      SpaceCode: { type: String, default: '' },
      Address: { type: String, default: '' },
      PricePerHour: { type: Number, default: 0 },
      Currency: { type: String, default: 'VND' },
      Timezone: { type: String, default: 'Asia/Ho_Chi_Minh' },
    },
    CancelReason: { type: String, default: '' },
    CancelledAt: { type: Date, default: null },
    CancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    CheckInAt: { type: Date, default: null },
    CheckOutAt: { type: Date, default: null },
    InstantBook: { type: Boolean, default: false },
    NoShow: { type: Boolean, default: false },
    AppliedPricingRules: [{ name: String, type: String, multiplier: Number }],
    AddOns: [
      {
        AddOnID: { type: mongoose.Schema.Types.ObjectId, ref: 'AddOn' },
        Name: { type: String, default: '' },
        UnitPrice: { type: Number, default: 0 },
        Quantity: { type: Number, default: 1, min: 1 },
        LineTotal: { type: Number, default: 0 },
      },
    ],
    AddOnsTotal: { type: Number, default: 0, min: 0 },
    BaseAmount: { type: Number, default: 0, min: 0 },

}, { 
    // Tự động tạo CreateAt và UpdateAt
    timestamps: true 
});

// 5. CHỈ MỤC PHỨC HỢP (COMPOSITE INDEX)
bookingSchema.index({ SpaceID: 1, StartTime: 1, EndTime: 1 });
bookingSchema.index({ CustomerID: 1, createdAt: -1 });
bookingSchema.index({ HostID: 1, createdAt: -1 });
bookingSchema.index({ Status: 1, EndTime: 1 });

module.exports = mongoose.model('Booking', bookingSchema);

