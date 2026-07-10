const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    // 1. LIÊN KẾT (RELATIONSHIPS)
    SpaceID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Space',
        required: true,
        index: true 
    },
    CustomerID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    BookingID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true,
        unique: true 
    },

    // 2. NỘI DUNG ĐÁNH GIÁ (CONTENT)
    Rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    Comment: {
        type: String,
        trim: true,
        default: ""
    }
}, {
    collection: 'reviews',
    timestamps: true 
});

// 3. CHỈ MỤC PHỨC HỢP
reviewSchema.index({ CustomerID: 1, SpaceID: 1 });

// ==========================================
// 4. THUẬT TOÁN TÍNH ĐIỂM TRUNG BÌNH CỦA CHI NHÁNH
// ==========================================
reviewSchema.statics.calcAverageRatings = async function(spaceId) {
    try {
        const Space = mongoose.model('Space');
        const Branch = mongoose.model('Branch');

        // Bước 1: Tìm Space để biết nó thuộc Branch nào
        const space = await Space.findById(spaceId);
        if (!space || !space.BranchID) return;

        const branchId = space.BranchID;

        // Bước 2: Lấy TẤT CẢ các Space thuộc Branch này
        const spacesInBranch = await Space.find({ BranchID: branchId }).select('_id');
        const spaceIds = spacesInBranch.map(s => s._id);

        // Bước 3: Gom tất cả Review của tập hợp các Space trên và tính trung bình
        const branchStats = await this.aggregate([
            { $match: { SpaceID: { $in: spaceIds } } },
            { $group: {
                _id: null,
                avgRating: { $avg: '$Rating' } // Hàm $avg cộng tổng và chia đều
            }}
        ]);

        // Bước 4: Lưu vào RatingAvg của bảng Branch
        if (branchStats.length > 0) {
            // Giữ lại 1 số thập phân (Ví dụ: (4 + 5) / 2 = 4.5)
            const newBranchAvg = Math.round(branchStats[0].avgRating * 10) / 10;
            await Branch.findByIdAndUpdate(branchId, { RatingAvg: newBranchAvg });
        } else {
            // Nếu không có đánh giá nào thì trả về 0
            await Branch.findByIdAndUpdate(branchId, { RatingAvg: 0 });
        }

        // TÙY CHỌN: Cập nhật luôn RatingAvg cho từng Space riêng lẻ (nếu cần hiển thị)
        const spaceStats = await this.aggregate([
            { $match: { SpaceID: spaceId } },
            { $group: { _id: null, avgRating: { $avg: '$Rating' } } }
        ]);
        if (spaceStats.length > 0) {
            const spaceAvg = Math.round(spaceStats[0].avgRating * 10) / 10;
            await Space.findByIdAndUpdate(spaceId, { RatingAvg: spaceAvg });
        }

    } catch (error) {
        console.error("Lỗi khi tính toán RatingAvg cho Branch:", error);
    }
};

// ==========================================
// 5. KÍCH HOẠT THUẬT TOÁN KHI LƯU/SỬA ĐÁNH GIÁ
// ==========================================

// Kích hoạt khi lưu mới Review
reviewSchema.post('save', function() {
    this.constructor.calcAverageRatings(this.SpaceID);
});

// Kích hoạt khi khách hàng cập nhật (sửa) Review
reviewSchema.pre(/^findOneAnd/, async function(next) {
    this.docToUpdate = await this.model.findOne(this.getQuery());
    next();
});

reviewSchema.post(/^findOneAnd/, async function() {
    if (this.docToUpdate) {
        await this.docToUpdate.constructor.calcAverageRatings(this.docToUpdate.SpaceID);
    }
});

module.exports = mongoose.model('Review', reviewSchema);