const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    // 1. LIÊN KẾT (RELATIONSHIPS) - Tối ưu cho thống kê doanh thu
    BookingID: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Booking', 
        required: true,
        index: true 
    },
    CustomerID: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },
    HostID: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },

    // 2. THÔNG TIN GIAO DỊCH (TRANSACTION INFO)
    TransactionCode: { 
        type: String, 
        required: true, 
        unique: true // Mã đối soát với VNPay/MoMo/Ngân hàng
    }, 
    Amount: { 
        type: Number, 
        required: true, 
        min: 0 
    },
    
    // 3. PHÂN LOẠI THANH TOÁN
    PaymentType: { 
        type: String, 
        enum: ['deposit', 'full_payment', 'remaining_balance'], 
        default: 'deposit' 
    },
    PaymentMethod: { 
        type: String, 
        enum: ['bank_transfer', 'cash', 'e_wallet'], 
        default: 'bank_transfer' 
    },

    // 4. TRẠNG THÁI GIAO DỊCH
    Status: { 
        type: String, 
        enum: ['pending', 'successful', 'failed', 'refunded', 'refund_pending'], 
        default: 'pending',
        index: true 
    },
    PaidAt: { 
        type: Date // Chỉ ghi nhận thời gian khi Status chuyển sang 'successful'
    },
    VerifiedAt: { type: Date },
    VerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    FailureReason: { type: String, default: '' },
    RefundedAt: { type: Date },
    IdempotencyKey: {
        type: String,
        index: true,
        sparse: true
    }

}, { 
    collection: 'payment_histories',
    timestamps: true 
});

// 5. CHỈ MỤC PHỨC HỢP (COMPOSITE INDEX)
paymentSchema.index({ HostID: 1, Status: 1, createdAt: -1 });
paymentSchema.index({ BookingID: 1, Status: 1 });
paymentSchema.index({ CustomerID: 1, createdAt: -1 });
paymentSchema.index(
  { BookingID: 1, CustomerID: 1, IdempotencyKey: 1 },
  { unique: true, partialFilterExpression: { IdempotencyKey: { $type: 'string' } } }
);

// At most one pending payment per booking/customer/stage
paymentSchema.index(
  { BookingID: 1, CustomerID: 1, PaymentType: 1, Status: 1 },
  {
    unique: true,
    partialFilterExpression: { Status: 'pending' },
  }
);

module.exports = mongoose.model('PaymentHistory', paymentSchema);
