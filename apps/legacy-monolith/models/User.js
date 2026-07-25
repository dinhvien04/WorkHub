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
        required: function requiredPassword() {
          // OAuth-only accounts may not have a password
          return this.AuthProvider === 'local' || !this.AuthProvider;
        },
    },
    AuthProvider: {
        type: String,
        enum: ['local', 'google'],
        default: 'local',
        index: true,
    },
    // Only set for Google-linked accounts (omit field otherwise — unique sparse)
    GoogleSub: {
        type: String,
        sparse: true,
        unique: true,
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
    },
    // Incremented on password change / force-logout to invalidate existing JWTs
    tokenVersion: {
        type: Number,
        default: 0
    },

    // Local customers start false until email confirm; Google/migrated may be true
    EmailVerified: { type: Boolean, default: false },
    EmailVerifiedAt: { type: Date, default: null },

    // TOTP 2FA (secret never returned in public DTOs)
    TotpEnabled: { type: Boolean, default: false },
    TotpSecret: { type: String, default: null, select: false },
    TotpRecoveryHashes: { type: [String], default: [], select: false },

    // Notification preferences
    NotifyEmail: { type: Boolean, default: true },
    NotifyPush: { type: Boolean, default: true },
    NotifySms: { type: Boolean, default: false },
    MarketingOptIn: { type: Boolean, default: false },
    PreferredLang: { type: String, default: 'vi', maxlength: 8 },
    Timezone: { type: String, default: 'Asia/Ho_Chi_Minh', maxlength: 64 },

}, {
    collection: 'users',
    timestamps: true // Tự động sinh ra CreatedAt và UpdatedAt
});

// Compound index for admin queries filtering by role + status (e.g. list active hosts)
userSchema.index({ Role: 1, Status: 1 });

module.exports = mongoose.model('User', userSchema);