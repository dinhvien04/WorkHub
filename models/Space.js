const mongoose = require('mongoose');

const spaceSchema = new mongoose.Schema({
    // 1. LIÊN KẾT (RELATIONSHIPS)
    BranchID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Branch',
        required: true,
        index: true
    },
    HostID: { // Lưu thêm HostID để Host lọc danh sách phòng của mình nhanh
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: true,
        index: true
    },

    // 2. ĐỊNH DANH & PHÂN LOẠI (IDENTIFICATION & CATEGORY)
    SpaceCode: { 
        type: String, // Ví dụ: B-01, VIP-02 (Mã do Host tự quản lý)
        required: true,
        trim: true
    },
    Name: { 
        type: String, // Ví dụ: Bàn đơn yên tĩnh, Phòng họp 10 người
        required: true,
        trim: true
    },
    Category: { 
        type: String,
        enum: ['meeting_room', 'desk'],
        default: 'desk',
        index: true
    },
    Description: { 
        type: String, 
        default: "" 
    },

    // 3. THÔNG SỐ VÀ TIỆN ÍCH (SPECS & AMENITIES)
    Capacity: { 
        type: Number, 
        default: 1, 
        min: 1 
    },
    Amenities: { 
        type: [String], // Ví dụ: ['Wifi', 'Máy chiếu', 'Bảng trắng', 'Điều hòa']
        default: [] 
    },
    Images: { 
        type: [String], // Chứa các đường link URL ảnh tải lên từ Cloudinary/S3
        default: [] 
    },

    // 4. TÀI CHÍNH (FINANCE)
    PricePerHour: { 
        type: Number, 
        required: true, 
        min: 0 
    },
    /** Duration package prices (optional). Used when booking length meets tier. */
    PricePerHalfDay: { type: Number, default: null, min: 0 },
    PricePerDay: { type: Number, default: null, min: 0 },
    PricePerWeek: { type: Number, default: null, min: 0 },
    PricePerMonth: { type: Number, default: null, min: 0 },
    DepositAmount: { 
        type: Number, 
        default: 0, 
        min: 0 
    },

    // 5. TRẠNG THÁI & THỐNG KÊ (STATUS & STATS)
    Status: { 
        type: String,
        enum: ['available'
            , 'maintenance'// Tạm khóa để bảo trì, sửa chữa
            , 'inactive'//Tạm khóa vì đang có khách sử dụng/Chờ dọn dẹp
        ],
        default: 'available',
        index: true
    },
    InstantBook: {
        type: Boolean,
        default: false,
        index: true,
    },
    /** Minutes blocked before booking start (setup) */
    BufferBeforeMinutes: { type: Number, default: 0, min: 0, max: 180 },
    /** Minutes blocked after booking end (cleanup) */
    CleanupAfterMinutes: { type: Number, default: 0, min: 0, max: 180 },
    FreeCancelHours: { type: Number, default: 24, min: 0, max: 168 },
    RatingAvg: { 
        type: Number, 
        default: 0 
    },
    RatingCount: { 
        type: Number, 
        default: 0 
    },
    Moderation: {
      LastAction: { type: String, default: '' },
      Reason: { type: String, default: '' },
      Note: { type: String, default: '' },
      ModeratedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      ModeratedAt: { type: Date, default: null },
    },

}, {
    collection: 'spaces',
    timestamps: true
});

// 6. CHỈ MỤC PHỨC HỢP ĐỘC QUYỀN (UNIQUE COMPOSITE INDEX) 
// Báo cho MongoDB biết: "Trong CÙNG MỘT Chi nhánh, không được có 2 phòng trùng Mã"
// Nhưng 2 Chi nhánh khác nhau thì CÓ THỂ dùng chung một Mã phòng.
spaceSchema.index({ BranchID: 1, SpaceCode: 1 }, { unique: true });

module.exports = mongoose.model('Space', spaceSchema);