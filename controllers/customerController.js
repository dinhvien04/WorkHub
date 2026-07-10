const mongoose = require('mongoose');
const User = require('../models/User');
const CustomerProfile = require('../models/Customer_Profile');
const Booking = require('../models/Booking');
const PaymentHistory = require('../models/Payment_History');
const Review = require('../models/Review');
const Branch = require('../models/Branch');
const Space = require('../models/Space');
const logActivity = require('../utils/auditLogger');
const bookingService = require('../services/bookingService');
const paymentService = require('../services/paymentService');
const { safeRegexQuery } = require('../utils/escapeRegex');
const { parsePagination, paginationMeta } = require('../utils/pagination');
const { ForbiddenError, NotFoundError, ValidationError } = require('../utils/errors');



const cloudinary = require('cloudinary').v2;

// Cấu hình Cloudinary để gọi API hủy ảnh cũ
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
// ==========================================
// HÀM HỖ TRỢ CHUNG
// ==========================================
function sendServerError(res, error) {
  console.error("Lỗi Controller:", error);
  return res.status(500).json({ error: 'Lỗi máy chủ, vui lòng thử lại sau.' });
}

// ==========================================
// KHU VỰC 1: CÁC HÀM RENDER GIAO DIỆN
// ==========================================
async function getHomePage(req, res) {
  try {
    const branches = await Branch.find({ Status: 'active' }).lean();
    res.render('customer/home', { 
      branches,
      scripts: '<script src="/js/customer-main.js"></script>'
    });
  } catch (error) {
    return sendServerError(res, error);
  }
}

// ==========================================
// TÌM KIẾM CƠ SỞ (ĐÃ MỞ RỘNG TÌM THEO ĐỊA CHỈ)
// ==========================================
async function searchBranches(req, res){
  try {
    const { location } = req.query;
    let query = { Status: 'active' };
    
    if (location && location.trim()) {
      const rx = safeRegexQuery(location, 100);
      if (rx) {
        query.$or = [
          { Name: rx },
          { Address: rx },
          { District: rx },
          { City: rx },
        ];
      }
    }

    const { page, limit, skip } = parsePagination(req.query, { page: 1, limit: 50, maxLimit: 100 });
    const branches = await Branch.find(query).skip(skip).limit(limit).lean();
    
    res.render('customer/search', { 
      branches, 
      keyword: location || "",
      scripts: '<script src="/js/customer-main.js"></script>' 
    });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function detailPage(req, res) {
    try {
        const { branchId } = req.query;
        if (!branchId) return res.status(400).send("Thiếu ID chi nhánh");

        const branch = await Branch.findById(branchId).lean();
        if (!branch) return res.status(404).send("Không tìm thấy chi nhánh");

        const spaces = await Space.find({
            BranchID: branchId,
            Status: 'available'
        }).sort({ Category: 1, Name: 1 }).lean();

        res.render('customer/detail', {
            branch,
            spaces,
            scripts: '<script src="/js/customer-main.js"></script>'
        });
    } catch (error) {
        return sendServerError(res, error);
    }
}

// ==========================================
// KHU VỰC 2: API HỒ SƠ KHÁCH HÀNG (KẾT HỢP NA & BẠN)
// ==========================================

/** @deprecated Use /me/profile. Enforces self-access only. */
async function getCustomerProfile(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'Thiếu userId.' });
    if (String(userId) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Bạn không có quyền xem hồ sơ người khác.' });
    }

    const profile = await CustomerProfile.findOne({ UserID: req.user.userId }).lean();
    const user = await User.findById(req.user.userId).select('-PasswordHash').lean();
    if (!user) return res.status(404).json({ error: 'Người dùng không tìm thấy.' });

    return res.json({ user, profile });
  } catch (error) {
    return sendServerError(res, error);
  }
}

/** @deprecated Use /me/profile. Enforces self-access + field whitelist. */
async function updateCustomerProfile(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'Thiếu userId.' });
    if (String(userId) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Bạn không có quyền cập nhật hồ sơ người khác.' });
    }

    const { FullName, Phone, BankName, BankNumber } = req.body;
    if (FullName?.trim()) {
      await User.findByIdAndUpdate(req.user.userId, { $set: { FullName: FullName.trim() } });
    }
    const updateData = {};
    if (Phone !== undefined) updateData.Phone = String(Phone).trim();
    if (BankName !== undefined) updateData.BankName = String(BankName).trim();
    if (BankNumber !== undefined) updateData.BankNumber = String(BankNumber).trim();

    const profile = await CustomerProfile.findOneAndUpdate(
      { UserID: req.user.userId },
      { $set: updateData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({ message: 'Cập nhật hồ sơ thành công.', profile });
  } catch (error) {
    return sendServerError(res, error);
  }
}

// (CỦA NA) Lấy hồ sơ của chính mình từ Token
async function getMyProfile(req, res) {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId).select('-PasswordHash -passwordHash').lean();
    if (!user) return res.status(404).json({ error: 'Người dùng không tìm thấy.' });

    const profile = await CustomerProfile.findOne({ UserID: userId }).lean();
    return res.json({ user, profile });
  } catch (error) {
    return sendServerError(res, error);
  }
}

// (CỦA NA) Cập nhật hồ sơ của chính mình + Upload Avatar
// ==========================================
// CẬP NHẬT HỒ SƠ CỦA CHÍNH MÌNH + DỌN AVATAR CŨ (CLOUDINARY)
// ==========================================
async function updateMyProfile(req, res) {
  try {
    const userId = req.user.userId;
    const { FullName, Phone, BankName, BankNumber } = req.body;

    if (FullName?.trim()) {
      await User.findByIdAndUpdate(userId, { $set: { FullName: FullName.trim() } });
    }

    const updateData = {};
    if (Phone !== undefined) updateData.Phone = Phone.trim();
    if (BankName !== undefined) updateData.BankName = BankName.trim();
    if (BankNumber !== undefined) updateData.BankNumber = BankNumber.trim();

    if (req.file) {
      updateData.Avatar = req.file.path; // Đường dẫn URL Cloudinary mới hoàn toàn

      // TIẾN HÀNH TÌM VÀ XOÁ AVATAR CŨ TRÊN CLOUDINARY
      const oldProfile = await CustomerProfile.findOne({ UserID: userId });
      
      if (oldProfile && oldProfile.Avatar) {
         try {
             // Sử dụng Regex bóc tách lấy public_id từ URL cũ của Cloudinary
             const matches = oldProfile.Avatar.match(/\/v\d+\/(.+?)\.[a-zA-Z0-9]+$/);
             if (matches && matches[1]) {
                 // Gọi lệnh tiêu diệt file cũ tận gốc trên mây
                 await cloudinary.uploader.destroy(matches[1]);
                 console.log("✅ Đã dọn dẹp Avatar Khách hàng cũ trên Cloudinary:", matches[1]);
             }
         } catch (cloudErr) {
             console.warn("⚠️ Bỏ qua lỗi xóa Avatar cũ trên Cloudinary:", cloudErr.message);
         }
      }
    }

    // Tiến hành cập nhật dữ liệu mới xuống MongoDB
    const profile = await CustomerProfile.findOneAndUpdate(
      { UserID: userId },
      { $set: updateData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    const user = await User.findById(userId).select('-PasswordHash -passwordHash').lean();

    // Giữ nguyên hệ thống Audit Log (Nhật ký hoạt động) chuẩn xác của bạn
    await logActivity(
        userId, 
        'UPDATE_PROFILE', 
        'User', 
        userId, 
        'Khách hàng vừa cập nhật hồ sơ cá nhân và thay đổi ảnh đại diện', 
        'info'
    );

    return res.json({ message: 'Cập nhật hồ sơ thành công.', user, profile });
  } catch (error) {
    return sendServerError(res, error);
  }
}
// ==========================================
// KHU VỰC 3: API QUẢN LÝ ĐƠN HÀNG (KẾT HỢP)
// ==========================================


// ==========================================
// 1. KIỂM TRA PHÒNG TRỐNG (BẢN CHUẨN - ĐÃ FIX MÚI GIỜ VÀ LOGIC TÌM KIẾM)
// ==========================================
async function checkAvailability(req, res) {
  try {
    // Prefer query (GET); body supported for backward compat
    const branchId = req.query.branchId || req.body?.branchId;
    const date = req.query.date || req.body?.date;
    const timeSlot = req.query.timeSlot || req.body?.timeSlot;
    const roomType = req.query.roomType || req.body?.roomType;

    if (!branchId || !date || !timeSlot || !roomType) {
      return res.status(400).json({ error: 'Thiếu dữ liệu: branchId, date, timeSlot, roomType' });
    }

    const [startStr, endStr] = timeSlot.split(' - ');
    if (!startStr || !endStr) return res.status(400).json({ error: 'Định dạng khung giờ không hợp lệ' });

    // [QUAN TRỌNG NHẤT]: Bắt buộc phải có +07:00 để đồng bộ với toISOString() của Frontend!
    const start = new Date(`${date}T${startStr}:00+07:00`);
    const end = new Date(`${date}T${endStr}:00+07:00`);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Ngày hoặc giờ không hợp lệ' });
    }

    // [BẢO MẬT]: Chặn tra cứu quá khứ bằng mili-giây để không bị dính lỗi múi giờ Server
    const now = new Date();
    if (start.getTime() < now.getTime()) {
      return res.status(400).json({ error: 'Không thể tra cứu phòng trống ở thời điểm trong quá khứ' });
    }

    const category = (roomType === 'meeting') ? 'meeting_room' : 'desk';

    // BƯỚC 1: TÌM TẤT CẢ PHÒNG THUỘC CHI NHÁNH VÀ ĐÚNG LOẠI
    const allSpaces = await Space.find({
      BranchID: branchId,
      Category: category,
      Status: 'available' 
    }).lean();

    // Nếu chi nhánh này không có phòng nào loại này, trả về rỗng ngay
    if (allSpaces.length === 0) {
        return res.json({ spaces: [], total: 0 });
    }

    // Gom danh sách ID của các phòng này lại
    const spaceIdsInBranch = allSpaces.map(s => s._id);

    // BƯỚC 2: TÌM CÁC ĐƠN HÀNG "CẤN LỊCH" DỰA TRÊN TẬP HỢP SPACE_ID THỰC TẾ
    const busyBookings = await Booking.find({
      SpaceID: { $in: spaceIdsInBranch },
      Status: { $in: ['pending', 'confirmed', 'in-use'] }, 
      StartTime: { $lt: end },
      EndTime: { $gt: start }
    }).select('SpaceID').lean();

    // Ép kiểu ID về chuỗi (String) để thuật toán Filter phía dưới không bị lỗi Object Reference
    const busySpaceIds = busyBookings.map(b => b.SpaceID.toString());

    // BƯỚC 3: LỌC RA NHỮNG PHÒNG TRỐNG THẬT SỰ
    const availableSpaces = allSpaces.filter(space => !busySpaceIds.includes(space._id.toString()));

    return res.json({ spaces: availableSpaces, total: availableSpaces.length });
  } catch (error) {
    return sendServerError(res, error);
  }
}
// ==========================================
// 2. TẠO ĐƠN HÀNG MỚI (ĐÃ FIX STATUS & RÀNG BUỘC THỜI GIAN)
// ==========================================
// ==========================================
// 1. TẠO ĐƠN HÀNG MỚI (Thuần túy tạo Hợp đồng)
// ==========================================
async function createBooking(req, res) {
  try {
    // Identity ONLY from token — ignore client-supplied CustomerID / userId
    const customerId = req.user.userId;
    if (req.params.userId && String(req.params.userId) !== String(customerId)) {
      return res.status(403).json({ error: 'Không được tạo booking cho người dùng khác.' });
    }

    const { spaceId, startTime, endTime, note } = req.body;
    const booking = await bookingService.createBooking({
      customerId,
      spaceId,
      startTime,
      endTime,
      note,
    });

    return res.status(201).json({ message: 'Tạo đơn đặt chỗ thành công', booking });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    return sendServerError(res, error);
  }
}

async function cancelBooking(req, res) {
  try {
    const customerId = req.user.userId;
    if (req.params.userId && String(req.params.userId) !== String(customerId)) {
      return res.status(403).json({ error: 'Không có quyền hủy đơn của người khác.' });
    }
    const { bookingId } = req.params;
    const booking = await bookingService.cancelBookingByCustomer(customerId, bookingId);
    return res.json({ message: 'Bạn đã hủy đơn đặt chỗ thành công.', booking });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    return sendServerError(res, error);
  }
}

// ==========================================
// 3. KHÁCH BÁO CÁO THANH TOÁN (ĐÃ FIX STATUS PENDING & ĐÚNG AMOUNT)
// ==========================================
//==========================================
// 3. KHÁCH BÁO CÁO THANH TOÁN (ROBUST FIX)
// ==========================================
// ==========================================
// 2. KHÁCH BÁO CÁO THANH TOÁN (Lưu trực tiếp vào Biên lai)
// ==========================================
async function confirmPayment(req, res) {
  try {
    const customerId = req.user.userId;
    const { bookingId, paymentType } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

    const idempotencyKey = req.get('Idempotency-Key') || req.body.idempotencyKey;
    const { payment, duplicate } = await paymentService.createPendingPayment({
      customerId,
      bookingId,
      paymentType,
      paymentMethod: 'bank_transfer',
      idempotencyKey,
    });

    const booking = await Booking.findOne({ _id: bookingId, CustomerID: customerId });
    return res.json({
      message: duplicate
        ? 'Yêu cầu thanh toán đã được ghi nhận trước đó.'
        : 'Đã gửi yêu cầu xác nhận thanh toán thành công!',
      booking,
      payment,
      duplicate,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    return sendServerError(res, error);
  }
}

async function payRemainder(req, res) {
  try {
    const customerId = req.user.userId;
    if (req.params.userId && String(req.params.userId) !== String(customerId)) {
      return res.status(403).json({ error: 'Không có quyền thanh toán đơn của người khác.' });
    }
    const { bookingId } = req.params;
    const idempotencyKey = req.get('Idempotency-Key') || req.body.idempotencyKey;

    const { payment, duplicate } = await paymentService.createPendingPayment({
      customerId,
      bookingId,
      paymentType: 'remaining_balance',
      paymentMethod: req.body.paymentMethod || 'bank_transfer',
      idempotencyKey,
    });

    const booking = await Booking.findOne({ _id: bookingId, CustomerID: customerId });
    return res.json({
      message: duplicate
        ? 'Yêu cầu thanh toán đã được ghi nhận trước đó.'
        : 'Đã gửi báo cáo thanh toán phần còn lại, đang chờ duyệt.',
      booking,
      payment,
      duplicate,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    return sendServerError(res, error);
  }
}
// ==========================================
// KHU VỰC 4: API ĐÁNH GIÁ (REVIEW)
// ==========================================

// ==========================================
// API ĐÁNH GIÁ (ĐÃ BỌC THÉP CHỐNG LỖI CLICK ĐÚP - RACE CONDITION)
// ==========================================
async function submitReview(req, res) {
    try {
        const customerId = req.user.userId;
        if (req.params.userId && String(req.params.userId) !== String(customerId)) {
            return res.status(403).json({ error: 'Không có quyền đánh giá đơn của người khác.' });
        }
        const { bookingId } = req.params;
        const { rating, comment } = req.body;

        const ratingNum = Number(rating);
        if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({ error: 'Rating phải từ 1 đến 5.' });
        }
        const safeComment = String(comment || '').slice(0, 2000);

        const booking = await Booking.findOne({ _id: bookingId, CustomerID: customerId });
        if (!booking || booking.Status !== 'completed') {
            return res.status(400).json({ error: 'Đơn hàng không hợp lệ hoặc chưa hoàn tất.' });
        }

        let review = await Review.findOne({ BookingID: bookingId, CustomerID: customerId });

        if (review) {
            const daysSinceReview = (new Date() - new Date(review.createdAt)) / (1000 * 3600 * 24);
            if (daysSinceReview > 7) {
                return res.status(400).json({ error: 'Đã quá 7 ngày, bạn không thể chỉnh sửa đánh giá.' });
            }
            review.Rating = ratingNum;
            review.Comment = safeComment;
            await review.save();

            await logActivity(customerId, 'UPDATE_REVIEW', 'Review', review._id, `Khách hàng vừa cập nhật đánh giá cho đơn hàng`, 'info');
            return res.json({ message: 'Cập nhật đánh giá thành công!', review });
        } else {
            try {
                review = await Review.create({
                    SpaceID: booking.SpaceID,
                    CustomerID: customerId,
                    BookingID: bookingId,
                    Rating: ratingNum,
                    Comment: safeComment
                });
                await logActivity(customerId, 'SUBMIT_REVIEW', 'Review', review._id, `Khách hàng đã đánh giá không gian ${ratingNum} sao`, 'info');
                return res.json({ message: 'Cảm ơn bạn đã đánh giá!', review });
                
            } catch (createErr) {
                if (createErr.code === 11000) {
                    return res.status(400).json({ error: 'Hệ thống đang xử lý, đánh giá của bạn đã được ghi nhận!' });
                }
                throw createErr; 
            }
        }
    } catch (error) {
        return sendServerError(res, error);
    }
}

// (CỦA NA) Lấy Review đơn lẻ
async function getReview(req, res) {
  try {
    const { bookingId } = req.params;

    const review = await Review.findOne({ BookingID: bookingId })
        .populate('CustomerID', 'FullName fullName Avatar avatarUrl')
        .lean();
    if (!review) {
      return res.status(404).json({ error: 'Không tìm thấy đánh giá cho đơn hàng này.' });
    }

    return res.json({ review });
  } catch (error) {
    return sendServerError(res, error);
  }
}

// (CỦA BẠN - GIỮ NGUYÊN BỞI VÌ NÓ XỬ LÝ LỖI ĐẶT TÊN BIẾN RẤT TỐT: fullName vs FullName)
async function getBranchReviews(req, res) {
    try {
        const { branchId } = req.params;
        if (!branchId) return res.status(400).json({ error: 'Thiếu branchId.' });

        const spaces = await Space.find({ BranchID: branchId }).select('_id').lean();
        const spaceIds = spaces.map(s => s._id);

        if (spaceIds.length === 0) return res.json({ reviews: [] });

        const reviews = await Review.find({ SpaceID: { $in: spaceIds } })
            .sort({ createdAt: -1 })
            .populate('CustomerID', 'FullName fullName Avatar avatarUrl')
            .lean();

        const formatted = reviews.map(r => ({
            _id: r._id,
            spaceId: r.SpaceID,
            customerId: r.CustomerID?._id,
            customerName: r.CustomerID?.FullName || r.CustomerID?.fullName || '',
            customerAvatar: r.CustomerID?.Avatar || r.CustomerID?.avatarUrl || '',
            rating: r.Rating,
            comment: r.Comment,
            createdAt: r.createdAt
        }));

        return res.json({ reviews: formatted });
    } catch (err) {
        return sendServerError(res, err);
    }
}


// ==========================================
// API QUẢN LÝ ĐƠN HÀNG (ĐỊNH NGHĨA % THEO PAYMENT_TYPE)
// ==========================================
async function getCustomerBookings(req, res) {
  try {
    const customerId = req.user.userId;
    if (req.params.userId && String(req.params.userId) !== String(customerId)) {
      return res.status(403).json({ error: 'Không có quyền xem booking của người khác.' });
    }

    const { page, limit, skip } = parsePagination(req.query, { page: 1, limit: 50, maxLimit: 100 });

    const [bookings, total] = await Promise.all([
      Booking.find({ CustomerID: customerId })
        .populate({
          path: 'SpaceID',
          select: 'Name Images SpaceCode BranchID PricePerHour',
          populate: { path: 'BranchID', select: 'Name Address Hotline' }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Booking.countDocuments({ CustomerID: customerId }),
    ]);

    const bookingIds = bookings.map(b => b._id);
    const reviews = await Review.find({ BookingID: { $in: bookingIds } }).lean();
    const reviewMap = {};
    reviews.forEach(r => { reviewMap[r.BookingID.toString()] = r; });

    // Only successful payments count toward paid %
    const payments = await PaymentHistory.find({
      BookingID: { $in: bookingIds },
      Status: 'successful',
    }).lean();

    const paidMap = {};
    payments.forEach(p => {
      const bId = p.BookingID.toString();
      paidMap[bId] = (paidMap[bId] || 0) + p.Amount;
    });

    const now = new Date();
    const result = bookings.map(b => {
      const review = reviewMap[b._id.toString()];
      let canReview = false;
      let canEditReview = false;

      if (b.Status === 'completed') {
        if (!review) canReview = true;
        else {
          const daysSinceReview = (now - new Date(review.createdAt)) / (1000 * 3600 * 24);
          if (daysSinceReview <= 7) canEditReview = true;
        }
      }

      const paid = paidMap[b._id.toString()] || 0;
      const percentPaid = b.TotalAmount > 0 ? Math.min(100, Math.round((paid / b.TotalAmount) * 100)) : 0;

      return { ...b, ReviewData: review, canReview, canEditReview, percentPaid, paidAmount: paid };
    });

    return res.json({ bookings: result, pagination: paginationMeta(total, page, limit) });
  } catch (error) {
    return sendServerError(res, error);
  }
}
// ==========================================
// RENDER TRANG LỊCH SỬ THANH TOÁN (SSR - TRUY VẤN DÒNG TIỀN)
// ==========================================
async function getPaymentHistoryPage(req, res) {
    try {
        const userId = req.user?.userId || req.user?.id || req.user?._id;   
        if (!userId) return res.status(401).send("Vui lòng đăng nhập để xem lịch sử thanh toán.");

        const { branchKeyword, startDate, statusFilter } = req.query;
        
        let query = { CustomerID: userId };

        const statusMap = {
            'Thành công': ['successful'],
            'Thất bại': ['failed'],
            'Chờ xử lý': ['pending']
        };

        if (statusFilter && statusFilter !== 'Tất cả') {
            query.Status = { $in: statusMap[statusFilter] || ['successful', 'failed', 'pending'] };
        }

        if (startDate) {
            const startOfDay = new Date(startDate);
            startOfDay.setHours(0, 0, 0, 0);
            query.createdAt = { $gte: startOfDay };
        }

        let payments = await PaymentHistory.find(query)
            .populate({
                path: 'BookingID',
                populate: { path: 'SpaceID', select: 'Name name' }
            })
            .sort({ createdAt: -1 })
            .lean();

        if (branchKeyword) {
            payments = payments.filter(p => {
                const spaceName = p.BookingID?.SpaceID?.Name || p.BookingID?.SpaceID?.name || '';
                return spaceName.toLowerCase().includes(branchKeyword.toLowerCase());
            });
        }

        const allSpaces = await Space.find({}).select('Name name').lean();

        res.render('customer/payment_history', { 
            payments, 
            filters: { branchKeyword: branchKeyword || '', startDate: startDate || '', statusFilter: statusFilter || 'Tất cả' },
            allSpaces,
            userId: userId,
            scripts: '<script src="/js/customer-main.js"></script>'
        });
    } catch (error) {
        console.error("Lỗi payment_history Controller:", error);
        res.status(500).send("Lỗi kết nối CSDL: " + error.message);
    }
}
module.exports = {
  getHomePage,
  searchBranches,
  detailPage,
  getCustomerProfile,
  updateCustomerProfile,
  getMyProfile,
  updateMyProfile,
  getCustomerBookings,
  checkAvailability,
  createBooking,
  cancelBooking,
  confirmPayment,
  payRemainder,
  submitReview, 
  getReview,
  getBranchReviews,
  getPaymentHistoryPage
};