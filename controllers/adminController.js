const mongoose = require('mongoose');
const HostProfile = require('../models/Host_Profile');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Branch = require('../models/Branch');
const Space = require('../models/Space');
const PaymentHistory = require('../models/Payment_History');
const logActivity = require('../utils/auditLogger');
const AuditLog = require('../models/AuditLog');
const Review = require('../models/Review'); // ĐÃ THÊM: Thiếu model Review

function sendServerError(res, error) {
  console.error(error);
  return res.status(500).json({ error: 'Lỗi máy chủ, vui lòng thử lại sau.' });
}

// =====================================
// API TRẢ VỀ DỮ LIỆU DASHBOARD QUẢN TRỊ
// =====================================
async function getAdminDashboard(req, res) {
  try {
    const { startDate, endDate, keyword } = req.query;

    // Loại bỏ các đơn hàng mang trạng thái dữ liệu rác
    let bookingMatch = { Status: { $in: ['pending', 'confirmed', 'in-use', 'completed', 'cancelled'] } };
    let paymentMatch = { Status: 'successful' };
    let generalMatch = {}; 

    // 1. Đồng bộ xử lý khoảng thời gian lọc
    if (startDate && endDate) {
      const dateCond = {
        $gte: new Date(`${startDate}T00:00:00.000Z`),
        $lte: new Date(`${endDate}T23:59:59.999Z`)
      };
      bookingMatch.createdAt = dateCond;
      paymentMatch.createdAt = dateCond;
      generalMatch.createdAt = dateCond;
    }

    // 2. Xử lý bộ lọc tìm kiếm theo Tên cơ sở hoặc Mã cơ sở
    if (keyword) {
      const regex = new RegExp(keyword.trim(), 'i');
      let branchIds = [];

      if (mongoose.Types.ObjectId.isValid(keyword.trim())) {
        branchIds.push(new mongoose.Types.ObjectId(keyword.trim()));
      }

      const matchedBranches = await Branch.find({ Name: regex }).select('_id').lean();
      matchedBranches.forEach(b => {
        if (!branchIds.some(id => id.equals(b._id))) branchIds.push(b._id);
      });

      if (branchIds.length > 0) {
        const spacesInBranches = await Space.find({ BranchID: { $in: branchIds } }).select('_id').lean();
        const spaceIds = spacesInBranches.map(s => s._id);

        bookingMatch.SpaceID = { $in: spaceIds };

        const matchedBookings = await Booking.find({ SpaceID: { $in: spaceIds } }).select('_id').lean();
        const matchedBookingIds = matchedBookings.map(b => b._id);
        paymentMatch.BookingID = { $in: matchedBookingIds };
      } else {
        const dummyId = new mongoose.Types.ObjectId("000000000000000000000000");
        bookingMatch._id = dummyId;
        paymentMatch._id = dummyId;
      }
    }

    // 3. Thực thi Query song song đồng bộ theo thời gian lọc
    const [
      basicCounts,
      revenueByDay,
      topHosts,
      bookingStatusStats,
      auditLogsDB 
    ] = await Promise.all([
      Promise.all([
        User.countDocuments(generalMatch),
        User.countDocuments({ Role: 'customer', ...generalMatch }),
        User.countDocuments({ Role: 'host', ...generalMatch }),
        Booking.countDocuments(bookingMatch),
        Branch.countDocuments(generalMatch),
        Space.countDocuments(generalMatch)
      ]),
      PaymentHistory.aggregate([
        { $match: paymentMatch },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, total: { $sum: "$Amount" } } },
        { $sort: { _id: 1 } }
      ]),
      PaymentHistory.aggregate([
        { $match: paymentMatch },
        { $group: { _id: "$HostID", total: { $sum: "$Amount" } } },
        { $sort: { total: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'host_profiles', localField: '_id', foreignField: 'UserID', as: 'profile' } },
        { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } }
      ]),
      Booking.aggregate([
        { $match: bookingMatch },
        { $group: { _id: "$Status", count: { $sum: 1 } } }
      ]),
      AuditLog.find(generalMatch).sort({ createdAt: -1 }).limit(6).lean()
    ]);

    // Format lại dữ liệu cho Frontend vẽ giao diện
    const logs = auditLogsDB.map(log => {
        let icon = '⚡'; 
        let color = 'text-slate-500';

        const action = String(log.ActionType || '').toUpperCase();

        if (action.includes('LOGIN')) { 
            icon = '👤'; color = 'text-blue-500'; 
        } else if (action.includes('REGISTER')) { 
            icon = '✨'; color = 'text-emerald-500'; 
        } else if (action.includes('BAN_USER')) { 
            icon = '⛔'; color = 'text-red-500'; 
        } else if (action.includes('UNBAN_USER')) { 
            icon = '✅'; color = 'text-green-500'; 
        } else if (action.includes('VERIFY_HOST')) { 
            icon = '👑'; color = 'text-purple-500'; 
        } else if (action.includes('CREATE_BOOKING')) { 
            icon = '📅'; color = 'text-indigo-500'; 
        } else if (action.includes('CANCEL_BOOKING')) { 
            icon = '⚠️'; color = 'text-amber-500'; 
        } else if (action.includes('PAYMENT')) { 
            icon = '💰'; color = 'text-emerald-600'; 
        } else if (action.includes('CONFIRM')) { 
            icon = '✅'; color = 'text-teal-500'; 
        } else if (action.includes('CHECKIN')) { 
            icon = '🔑'; color = 'text-blue-600'; 
        }

        return {
            time: log.createdAt,
            text: log.Description,
            icon: icon,
            color: color
        };
    });

    return res.json({
      totals: { users: basicCounts[0], customers: basicCounts[1], hosts: basicCounts[2], bookings: basicCounts[3], branches: basicCounts[4], spaces: basicCounts[5] },
      revenueByDay,
      topHosts: topHosts.map(h => ({ name: h.profile?.CompanyName || h.user?.FullName || 'Không rõ', total: h.total })),
      bookingStatusStats,
      auditLogs: logs 
    });

  } catch (error) {
    return sendServerError(res, error);
  }
}

// =====================================
// CÁC HÀM QUẢN LÝ KHÁC
// =====================================
async function listUsers(req, res) {
  try {
    const users = await User.find().select('-PasswordHash').lean(); 
    return res.json({ users });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function toggleUserStatus(req, res) {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    if (user._id.toString() === req.user.userId) return res.status(400).json({ error: 'Bạn không thể tự khóa tài khoản của chính mình!' });

    user.Status = user.Status === 'active' ? 'banned' : 'active';
    // Invalidate all existing JWTs immediately
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    const severity = user.Status === 'banned' ? 'danger' : 'success';
    await logActivity(req.user.userId, user.Status === 'banned' ? 'BAN_USER' : 'UNBAN_USER', 'User', user._id, `Admin đã ${user.Status === 'banned' ? 'khóa' : 'mở khóa'} tài khoản của người dùng`, severity);
    return res.json({ message: `Đã ${user.Status === 'banned' ? 'khóa' : 'mở khóa'} tài khoản thành công!`, status: user.Status });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function getPendingHosts(req, res) {
  try {
    const pendingHosts = await HostProfile.find({ IsVerified: false }).populate('UserID', 'FullName Email Status').lean();
    return res.json({ hosts: pendingHosts });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function verifyHost(req, res) {
  try {
    const { id } = req.params; 
    const hostProfile = await HostProfile.findById(id);
    if (!hostProfile) return res.status(404).json({ error: 'Không tìm thấy hồ sơ Chủ cơ sở.' });

    hostProfile.IsVerified = true;
    await hostProfile.save();
    await logActivity(req.user.userId, 'VERIFY_HOST', 'HostProfile', hostProfile._id, `Admin đã phê duyệt tài khoản Chủ cơ sở: ${hostProfile.CompanyName || 'Chưa cập nhật tên'}`, 'success');
    return res.json({ message: 'Đã phê duyệt Chủ cơ sở thành công!' });
  } catch (error) {
    return sendServerError(res, error);
  }
}

// =====================================
// API TRANG NHẬT KÝ HOẠT ĐỘNG (AUDIT LOG)
// =====================================
async function getActivityLogs(req, res) {
    try {
        const { page = 1, limit = 50, search = '', entity = 'all', startDate, endDate } = req.query;
        let query = {};

        if (entity && entity !== 'all') {
            query.TargetEntity = entity;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(`${startDate}T00:00:00.000Z`);
            if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
        }

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { Description: regex },
                { ActionType: regex }
            ];
        }

        // ĐÃ SỬA: Đảm bảo số hóa dữ liệu phân trang an toàn
        const limitNum = parseInt(limit) || 50;
        const pageNum = parseInt(page) || 1;
        const skipIndex = (pageNum - 1) * limitNum;

        const [logs, totalLogs] = await Promise.all([
            AuditLog.find(query)
                .populate('ActorID', 'FullName Email Role') 
                .sort({ createdAt: -1 }) 
                .skip(skipIndex)
                .limit(limitNum)
                .lean(),
            AuditLog.countDocuments(query)
        ]);

        return res.json({
            logs,
            pagination: {
                totalLogs,
                currentPage: pageNum,
                totalPages: Math.ceil(totalLogs / limitNum),
                limit: limitNum
            }
        });

    } catch (error) {
        return sendServerError(res, error);
    }
}

// =====================================
// API: LẤY CHI TIẾT ĐỐI TƯỢNG CHO POPUP NHẬT KÝ
// =====================================
async function getEntityDetail(req, res) {
    try {
        const { type, id } = req.query;
        if (!type || !id) return res.status(400).json({ error: 'Thiếu tham số truy vấn.' });

        let data = null;
        const entityType = String(type).toUpperCase();
        let queryType = entityType;
        if (queryType === 'SUBMIT_REVIEW') queryType = 'REVIEW';

        // 1. Nếu là ĐƠN ĐẶT CHỖ (BOOKING)
        if (entityType === 'BOOKING') {
            data = await Booking.findById(id)
                .populate('UserID', 'FullName Email Phone')
                .populate({ 
                    path: 'SpaceID', 
                    select: 'Name PricePerHour PricePerDay BranchID',
                    populate: { path: 'BranchID', select: 'Name HostID', populate: { path: 'HostID', select: 'FullName Phone' } } 
                }).lean();
        } 
        // 2. Nếu là ĐÁNH GIÁ (REVIEW) - ĐÃ SỬA: Gom logic lại, xóa phần lặp thừa
        else if (queryType === 'REVIEW') {
            data = await Review.findById(id)
                .populate('CustomerID', 'FullName')
                .populate('SpaceID', 'Name')
                .lean();
        }
        // 3. Nếu là NGƯỜI DÙNG / CHỦ CƠ SỞ (USER / HOSTPROFILE)
        else if (entityType === 'USER' || entityType === 'HOSTPROFILE') {
            const user = await User.findById(id).select('-PasswordHash').lean();
            if (user) {
                let hostInfo = null;
                if (user.Role === 'host') {
                    hostInfo = await HostProfile.findOne({ UserID: id }).lean();
                }
                data = { user, hostInfo };
            }
        } 
        // 4. Nếu là KHÔNG GIAN / CHI NHÁNH (SPACE / BRANCH)
        else if (entityType === 'SPACE' || entityType === 'BRANCH') {
            if (entityType === 'SPACE') {
                data = await Space.findById(id).populate({ path: 'BranchID', select: 'Name HostID', populate: { path: 'HostID', select: 'FullName' } }).lean();
                if (data) data.isSpace = true;
            } else {
                data = await Branch.findById(id).populate('HostID', 'FullName').lean();
                if (data) data.isBranch = true;
            }
        } 
        // 5. Nếu là GIAO DỊCH (PAYMENT)
        else if (entityType === 'PAYMENT' || entityType === 'PAYMENTHISTORY') {
            data = await PaymentHistory.findById(id).populate('BookingID', '_id Status').lean();
        }
        
        // Nếu bản ghi đã bị xóa khỏi hệ thống
        if (!data) return res.status(404).json({ error: 'Dữ liệu này đã bị xóa hoặc không còn tồn tại trong hệ thống.' });

        return res.json({ type: entityType, data });

    } catch (error) {
        console.error("Lỗi getEntityDetail:", error);
        return res.status(500).json({ error: 'Lỗi máy chủ khi lấy dữ liệu chi tiết.' });
    }
}

module.exports = {
  getAdminDashboard,
  listUsers,
  toggleUserStatus,
  getPendingHosts, 
  verifyHost,
  getActivityLogs,
  getEntityDetail    
};