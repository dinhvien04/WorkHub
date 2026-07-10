const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    // 1. Kết nối cứng: Ai là người thực hiện hành động này?
    ActorID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // Để false đề phòng trường hợp hệ thống tự động quét và ghi nhật ký
    },
    // 2. Mã hành động (Viết hoa, ví dụ: BAN_USER, CREATE_BOOKING)
    ActionType: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },
    // 3. Tên bảng bị tác động (Dùng cho liên kết động)
    TargetEntity: {
        type: String,
        required: true,
        enum: ['Booking', 'Branch', 'CustomerProfile', 'HostProfile', 'PaymentHistory', 'Review', 'Space', 'User', 'System']
    },
    // 4. ID của bản ghi bị tác động (Dùng kết hợp với TargetEntity)
    TargetID: {
        type: mongoose.Schema.Types.ObjectId,
        required: false
    },
    // 5. Nội dung chi tiết in ra màn hình cho Admin đọc
    Description: {
        type: String,
        required: true,
        trim: true
    }
}, {
    // Tự động sinh ra thuộc tính createdAt (Thời gian xảy ra sự kiện) và updatedAt
    timestamps: true 
});


auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ ActorID: 1 });
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);