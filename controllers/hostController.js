const HostProfile = require('../models/Host_Profile');
const Branch = require('../models/Branch');
const Space = require('../models/Space');
const Booking = require('../models/Booking');
const User = require('../models/User');
const ExcelJS = require('exceljs');
const PaymentHistory = require('../models/Payment_History');
const logActivity = require('../utils/auditLogger');
const jwt = require('jsonwebtoken');

const cloudinary = require('cloudinary').v2;

// Cấu hình Cloudinary để gọi API xóa ảnh
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ==========================================
// HÀM HELPER KHÔNG ĐỔI
// ==========================================
const sendServerError = (res, error) => {
  console.error(error);
  return res.status(500).json({ error: 'Lỗi máy chủ, vui lòng thử lại sau.' });
};

// Middleware/Helper lấy Host ID từ token tiện dụng hơn
const getHostIdFromToken = (req) => {
  if (req.user) return req.user.id || req.user._id || req.user.userId;
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.split(' ')[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET || 'YOUR_SECRET_KEY');
  return decoded.userId || decoded.id || decoded._id;
};

// Phát tín hiệu Socket.io gọn gàng
const emitBookingUpdate = (bookingId, newStatus) => {
  if (global.io) {
    global.io.emit('booking_status_updated', { bookingId, newStatus });
  }
};

function mapCategory(type) {
  const map = {
    "Phòng họp": "meeting_room",
    "Chỗ ngồi tự do": "desk",
    "Văn phòng": "office",
    "Sự kiện": "event",
    meeting_room: "meeting_room",
    desk: "desk",
    office: "office",
    event: "event",
  };
  return map[type] || "desk";
}

function mapStatus(status) {
  const map = {
    ready: "available",
    preparing: "available",
    occupied: "available",
    suspended: "inactive",
    available: "available",
    maintenance: "maintenance",
    inactive: "inactive",
  };
  return map[status] || "available";
}

// ==========================================
// ĐIỀU HƯỚNG & BẢNG ĐIỀU KHIỂN
// ==========================================
async function renderDashboardView(req, res) {
  try {
    return res.render('host/dashboard', { scripts: '<script src="/js/host-spaces.js"></script>' });
  } catch (error) {
    console.error("Lỗi renderDashboardView:", error);
    return res.status(500).send("Lỗi tải trang bảng điều hành.");
  }
}

async function getDashboardStatsAPI(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    if (!hostId) return res.status(401).json({ error: 'Không tìm thấy Token xác thực.' });

    const { branchId } = req.query;
    const hostQuery = { $or: [{ HostID: hostId }, { hostID: hostId }] };

    const branches = await Branch.find(hostQuery).select('Name _id').lean();

    const spaceMatchCondition = branchId && branchId !== 'all'
      ? { $or: [{ BranchID: branchId }, { branchID: branchId }] }
      : hostQuery;

    const currentSpaces = await Space.find(spaceMatchCondition).select('_id SpaceCode Status spaceCode').lean();
    const spaceIds = currentSpaces.map(s => s._id);

    const defaultStats = {
      branches,
      stats: { revenue: 0, totalBookings: 0, totalOccupiedGuests: 0, activeRoomsCount: 0, paidAmount: 0, pendingAmount: 0 },
      liveFloorPlan: [], recentBookings: [], chartData: { labels: [], bookings: [], revenue: [] }
    };
    if (spaceIds.length === 0) return res.json(defaultStats);

    const bookingMatchCondition = { $or: [{ SpaceID: { $in: spaceIds } }, { spaceID: { $in: spaceIds } }] };

    const [bookingStats, totalBookings, totalOccupiedGuests] = await Promise.all([
      Booking.aggregate([
        { $match: { ...bookingMatchCondition, Status: { $ne: 'cancelled' } } },
        { $group: { _id: null, totalRevenue: { $sum: "$TotalAmount" }, totalDeposit: { $sum: "$DepositAmount" } } }
      ]),
      Booking.countDocuments({ ...bookingMatchCondition, Status: { $ne: 'cancelled' } }),
      Booking.countDocuments({ ...bookingMatchCondition, Status: 'completed' })
    ]);

    const revenue = bookingStats[0]?.totalRevenue || 0;
    const paidAmount = bookingStats[0]?.totalDeposit || 0;
    const activeRoomsCount = currentSpaces.filter(s => s.Status === 'available').length;

    const nowRealTime = new Date();
    const startOfDay = new Date(new Date(nowRealTime).setHours(0, 0, 0, 0));
    const endOfDay = new Date(new Date(nowRealTime).setHours(23, 59, 59, 999));

    const activeBookingsToday = await Booking.find({
      ...bookingMatchCondition,
      Status: { $in: ['confirmed', 'pending', 'in-use'] },
      StartTime: { $lte: endOfDay },
      EndTime: { $gte: startOfDay }
    }).lean();

    const liveFloorPlan = currentSpaces.map(space => {
      const spaceIdStr = space._id.toString();
      const bookingMatch = activeBookingsToday.find(b => (b.SpaceID || b.spaceID)?.toString() === spaceIdStr);

      let liveStatus = space.Status === 'maintenance' ? 'maintenance' : 'available';
      if (liveStatus !== 'maintenance' && bookingMatch) {
        liveStatus = bookingMatch.StartTime <= nowRealTime && bookingMatch.EndTime >= nowRealTime ? 'occupied' : 'upcoming';
      }
      return { SpaceCode: space.SpaceCode || space.spaceCode, LiveStatus: liveStatus };
    });

    const recentBookings = await Booking.find(hostQuery)
      .populate('CustomerID', 'fullName FullName Email email')
      .populate('SpaceID', 'SpaceCode spaceCode Name name')
      .sort({ createdAt: -1 }).limit(5).lean();

    const sevenDaysAgo = new Date(new Date().setHours(0, 0, 0, 0));
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const chartDataRaw = await Booking.aggregate([
      { $match: { ...bookingMatchCondition, Status: { $ne: 'cancelled' }, createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 }, revenue: { $sum: "$TotalAmount" } } },
      { $sort: { "_id": 1 } }
    ]);

    const chartData = { labels: [], bookings: [], revenue: [] };
    for (let i = 0; i <= 6; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const dateString = d.toISOString().split('T')[0];
      const found = chartDataRaw.find(item => item._id === dateString);

      chartData.labels.push(`${d.getDate()}/${d.getMonth() + 1}`);
      chartData.bookings.push(found ? found.count : 0);
      chartData.revenue.push(found ? found.revenue : 0);
    }

    return res.json({
      branches,
      stats: { revenue, totalBookings, totalOccupiedGuests, activeRoomsCount, paidAmount, pendingAmount: 0 },
      liveFloorPlan,
      recentBookings,
      chartData
    });
  } catch (error) {
    console.error("Lỗi getDashboardStatsAPI:", error);
    return res.status(500).json({ error: 'Lỗi hệ thống khi tải số liệu thống kê!' });
  }
}

// ==========================================
// HỒ SƠ HOST (PROFILE API)
// ==========================================
async function getProfileAPI(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    if (!hostId) return res.status(401).json({ error: 'Không tìm thấy Token xác thực.' });

    const user = await User.findById(hostId);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản Host này.' });

    const profile = await HostProfile.findOneAndUpdate(
      { UserID: hostId },
      { $setOnInsert: { CompanyName: 'Chưa cập nhật', Hotline: 'Chưa cập nhật', TaxCode: 'Chưa cập nhật', BankName: 'Chưa cập nhật', BankNumber: 'Chưa cập nhật', Logo: '' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    return res.json({
      user: { FullName: user.fullName || user.FullName || 'Chưa cập nhật', Email: user.email || user.Email || '', _id: user._id },
      profile: { CompanyName: profile.CompanyName, Hotline: profile.Hotline, TaxCode: profile.TaxCode, BankName: profile.BankName, BankNumber: profile.BankNumber, Logo: profile.Logo }
    });
  } catch (error) {
    console.error("Lỗi getProfileAPI:", error);
    return res.status(500).json({ error: 'Lỗi hệ thống khi lấy thông tin hồ sơ.' });
  }
}

// ==========================================
// CẬP NHẬT HỒ SƠ HOST (ĐÃ TÍCH HỢP XÓA LOGO CŨ TRÊN MÂY)
// ==========================================
async function updateProfileAPI(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    const { FullName, CompanyName, Hotline, TaxCode, BankName, BankNumber } = req.body;

    // 1. Cập nhật tên User nếu có
    if (FullName?.trim()) {
      await User.findByIdAndUpdate(hostId, { fullName: FullName.trim(), FullName: FullName.trim() });
    }

    let updateData = { CompanyName, Hotline, TaxCode, BankName, BankNumber };
    
    // 2. Nếu có upload Logo mới
    if (req.file) {
      updateData.Logo = req.file.path; // Gán URL Cloudinary mới

      // TÌM VÀ XÓA LOGO CŨ TRÊN CLOUDINARY
      const oldProfile = await HostProfile.findOne({ UserID: hostId });
      
      if (oldProfile && oldProfile.Logo) {
         try {
             // Lọc lấy public_id từ URL cũ
             const matches = oldProfile.Logo.match(/\/v\d+\/(.+?)\.[a-zA-Z0-9]+$/);
             if (matches && matches[1]) {
                 await cloudinary.uploader.destroy(matches[1]);
                 console.log("✅ Đã dọn dẹp Logo cũ trên Cloudinary:", matches[1]);
             }
         } catch (cloudErr) {
             console.warn("⚠️ Bỏ qua lỗi xóa Logo cũ trên Cloudinary:", cloudErr.message);
         }
      }
    }

    // 3. Tiến hành cập nhật DB
    await HostProfile.findOneAndUpdate(
        { UserID: hostId }, 
        updateData, 
        { returnDocument: 'after', upsert: true, runValidators: true }
    );
    
    return res.json({ success: true, message: 'Đã cập nhật hồ sơ thành công!' });
  } catch (error) {
    console.error("❌ Lỗi updateProfileAPI:", error);
    return res.status(500).json({ error: 'Lỗi hệ thống khi cập nhật hồ sơ' });
  }
}

// ==========================================
// QUẢN LÝ CHI NHÁNH & PHÒNG
// ==========================================
async function getHostBranches(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    const branches = await Branch.find({ $or: [{ HostID: hostId }, { hostID: hostId }] }).sort({ createdAt: -1 }).lean();
    return res.json({ branches });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function createBranch(req, res) {
  try {
    const hostId = getHostIdFromToken(req); 
    
    const images = [];
    // Lấy URL mây từ Cloudinary
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => images.push(file.path));
    }

    const branch = await Branch.create({
      HostID: hostId,
      Name: req.body.name,
      Address: req.body.address,
      Description: req.body.note || req.body.description || "",
      City: req.body.city || "",
      District: req.body.district || "",
      OpeningTime: req.body.openingTime || "07:00",
      ClosingTime: req.body.closingTime || "22:00",
      Status: 'active',
      Images: images
    });
    return res.status(201).json(branch);
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function updateBranch(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    const { branchId } = req.params;

    const updateData = {
      Name: req.body.name || undefined,
      Address: req.body.address || undefined,
      Description: req.body.note !== undefined ? req.body.note : undefined,
      OpeningTime: req.body.openingTime || undefined,
      ClosingTime: req.body.closingTime || undefined,
    };

    if (req.files && req.files.length > 0) {
      // Lấy URL mây từ Cloudinary
      const newImages = req.files.map((file) => file.path);
      const branch = await Branch.findOneAndUpdate(
        { _id: branchId, HostID: hostId },
        { $set: updateData, $push: { Images: { $each: newImages } } },
        { new: true }
      ).lean();

      if (!branch) return res.status(404).json({ error: "Chi nhánh không tìm thấy." });
      return res.json({ message: "Cập nhật cơ sở thành công.", branch });
    }

    const branch = await Branch.findOneAndUpdate(
      { _id: branchId, HostID: hostId },
      { $set: updateData },
      { new: true }
    ).lean();

    if (!branch) return res.status(404).json({ error: "Chi nhánh không tìm thấy." });
    return res.json({ message: "Cập nhật cơ sở thành công.", branch });
  } catch (error) {
    return sendServerError(res, error);
  }
}

function formatVND(value) {
  // Format số sang định dạng tiền tệ Việt Nam, ví dụ 1000000 -> 1.000.000
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

async function buildExcelBuffer(rows, reportTotals) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Báo cáo doanh thu');

  ws.columns = [
    { header: 'Booking ID', key: 'id', width: 20 },
    { header: 'Chi nhánh', key: 'branch', width: 20 },
    { header: 'Không gian', key: 'space', width: 20 },
    { header: 'Trạng thái', key: 'status', width: 12 },
    { header: 'Ngày tạo', key: 'createdAt', width: 18 },
    { header: 'Bắt đầu', key: 'startTime', width: 18 },
    { header: 'Kết thúc', key: 'endTime', width: 18 },
    { header: 'Tổng tiền (VND)', key: 'total', width: 15 },
    { header: 'Tiền cọc (VND)', key: 'deposit', width: 15 },
    { header: 'Ghi chú', key: 'note', width: 25 }
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'center' };

  rows.forEach(row => {
    ws.addRow(row);
  });

  ws.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.getCell('total').numFmt = '#,##0';
      row.getCell('deposit').numFmt = '#,##0';
      row.alignment = { horizontal: 'left', vertical: 'center' };
    }
  });

  const summaryStartRow = rows.length + 3;
  ws.getCell(`A${summaryStartRow}`).value = 'TÓM TẮT BÁO CÁO';
  ws.getCell(`A${summaryStartRow}`).font = { bold: true, size: 12 };
  ws.getCell(`A${summaryStartRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
  ws.mergeCells(`A${summaryStartRow}:B${summaryStartRow}`);

  const summaryData = [
    { label: 'Tổng giá trị giao dịch (GMV)', value: reportTotals.gmvText },
    { label: 'Tiền cọc đã thu', value: reportTotals.depositText },
    { label: 'Tổng nợ tại quầy', value: reportTotals.outstandingText },
    { label: 'Doanh thu hủy', value: reportTotals.cancelledText },
    { label: 'Tổng booking xác nhận', value: reportTotals.totalBookings }
  ];

  summaryData.forEach((item, idx) => {
    const row = summaryStartRow + 1 + idx;
    ws.getCell(`A${row}`).value = item.label;
    ws.getCell(`B${row}`).value = item.value;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.getCell(`B${row}`).font = { bold: true, color: { argb: 'FF0D8B8B' } };
  });

  return await workbook.xlsx.writeBuffer();
}

async function getHostReportsPage(req, res) {
  try {
    const hostId = req.currentUser?._id || req.user?.userId;
    if (!hostId) {
      return res.redirect('/login');
    }

    const role = req.currentUser?.Role || req.user?.role;
    if (role !== 'host') {
      return res.status(403).send('Chỉ chủ cơ sở mới được truy cập trang Báo cáo.');
    }

    // Lấy bộ lọc từ query string
    const { startDate, endDate } = req.query;
    const exportCsv = req.query.export === '1' || req.query.export === 'true';

    const branches = await Branch.find({ HostID: hostId }).sort({ Name: 1 }).lean();
    const hostSpaces = await Space.find({ HostID: hostId }).select('_id Name BranchID').lean();
    const filteredSpaceIds = hostSpaces.map(space => space._id);

    // Build bộ lọc cho booking theo SpaceID và theo ngày tạo booking nếu có
    const bookingFilter = {
      SpaceID: { $in: filteredSpaceIds.length ? filteredSpaceIds : [] }
    };

    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      bookingFilter.createdAt = { ...bookingFilter.createdAt, $gte: start };
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      bookingFilter.createdAt = { ...bookingFilter.createdAt, $lte: end };
    }

    // Tải booking phù hợp filter, đồng thời điền thông tin không gian (SpaceID)
    const allBookings = filteredSpaceIds.length
      ? await Booking.find(bookingFilter).populate({ path: 'SpaceID', select: 'Name BranchID' }).sort({ createdAt: -1 }).lean()
      : [];

    // Phân loại booking theo trạng thái để tính báo cáo
    const successfulBookings = allBookings.filter(booking => ['confirmed', 'completed'].includes(booking.Status));
    const cancelledBookings = allBookings.filter(booking => booking.Status === 'cancelled');

    // Tính tổng các chỉ số chính
    const totalGross = successfulBookings.reduce((sum, booking) => sum + Number(booking.TotalAmount || 0), 0);
    const totalDeposit = successfulBookings.reduce((sum, booking) => sum + Number(booking.DepositAmount || 0), 0);
    const totalOutstanding = totalGross - totalDeposit;
    const cancelledRevenue = cancelledBookings.reduce((sum, booking) => sum + Number(booking.TotalAmount || 0), 0);

    // Tạo map để tra branch name nhanh khi cần hiển thị hoặc export
    const branchMap = branches.reduce((map, branch) => {
      map[String(branch._id)] = branch.Name;
      return map;
    }, {});

    // Tính thống kê hiệu suất từng không gian
    const spaceStats = hostSpaces.reduce((map, space) => {
      const key = String(space._id);
      map[key] = {
        id: key,
        name: space.Name,
        branchName: branchMap[String(space.BranchID)] || 'Không rõ',
        count: 0,
        revenue: 0
      };
      return map;
    }, {});

    allBookings.forEach(booking => {
      const space = booking.SpaceID;
      const key = String(space?._id || '');
      if (!spaceStats[key]) return;
      spaceStats[key].count += 1;
      spaceStats[key].revenue += Number(booking.TotalAmount || 0);
    });

    const maxBookingCount = Math.max(...Object.values(spaceStats).map(item => item.count), 1);
    const performanceRows = Object.values(spaceStats)
      .filter(item => item.count > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map((item, index) => ({
        rank: index + 1,
        spaceName: item.name,
        branchName: item.branchName,
        bookings: item.count,
        fillRate: Math.round((item.count / maxBookingCount) * 100),
        revenueText: formatVND(item.revenue)
      }));

    const dailyRevenueMap = successfulBookings.reduce((map, booking) => {
      if (!booking.createdAt) return map;
      const dateKey = new Date(booking.createdAt).toISOString().slice(0, 10);
      map[dateKey] = (map[dateKey] || 0) + Number(booking.TotalAmount || 0);
      return map;
    }, {});

    const chartDates = Object.keys(dailyRevenueMap).sort();
    const chartLabels = chartDates.map(date => new Date(date).toLocaleDateString('vi-VN'));
    const chartRevenueData = chartDates.map(date => dailyRevenueMap[date]);

    // Dữ liệu gửi vào view để hiển thị các số liệu
    const reportTotals = {
      gmvText: formatVND(totalGross),
      depositText: formatVND(totalDeposit),
      outstandingText: formatVND(totalOutstanding),
      cancelledText: formatVND(cancelledRevenue),
      totalBookings: successfulBookings.length,
      totalSpaces: filteredSpaceIds.length,
      selectedBranchName: 'Tất cả chi nhánh'
    };

    // Tạo URL cho export và navigation giữ nguyên filter
    const queryParts = [];
    if (startDate) queryParts.push(`startDate=${encodeURIComponent(startDate)}`);
    if (endDate) queryParts.push(`endDate=${encodeURIComponent(endDate)}`);
    const reportUrl = '/host/reports' + (queryParts.length ? `?${queryParts.join('&')}` : '');
    const exportUrl = reportUrl + (queryParts.length ? '&export=1' : '?export=1');

    if (exportCsv) {
      // Nếu xuất Excel nhưng không có dữ liệu, trả về thông báo lỗi JSON
      if (allBookings.length === 0) {
        return res.status(400).json({ 
          error: 'Hiện chưa có dữ liệu báo cáo!' 
        });
      }

      const rows = allBookings.map(booking => ({
        id: String(booking._id),
        branch: branchMap[String(booking.SpaceID?.BranchID)] || 'Không rõ',
        space: booking.SpaceID?.Name || 'Không rõ',
        status: booking.Status,
        createdAt: booking.createdAt ? new Date(booking.createdAt).toLocaleString('vi-VN') : '',
        startTime: booking.StartTime ? new Date(booking.StartTime).toLocaleString('vi-VN') : '',
        endTime: booking.EndTime ? new Date(booking.EndTime).toLocaleString('vi-VN') : '',
        total: Number(booking.TotalAmount || 0),
        deposit: Number(booking.DepositAmount || 0),
        note: booking.Note || ''
      }));

      const excelBuffer = await buildExcelBuffer(rows, reportTotals);
      const fileName = `workhub-host-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(excelBuffer);
    }

    // Render trang báo cáo với dữ liệu và URL export đã tạo
    return res.render('host/reports', {
      branches,
      filters: {
        startDate: startDate || '',
        endDate: endDate || ''
      },
      reportTotals,
      performanceRows,
      chartLabels,
      chartRevenueData,
      exportUrl,
      scripts: '<script src="/js/host-spaces.js"></script>'
    });
  } catch (error) {
    return sendServerError(res, error);
  }
}

// ==========================================
// CẬP NHẬT LẠI HÀM XÓA ẢNH CƠ SỞ (XÓA SẠCH TRÊN CLOUDINARY)
// ==========================================
async function deleteBranchImage(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    const { branchId } = req.params;
    const { imageUrl } = req.body;

    // 1. Lọc lấy public_id từ URL và Xóa ảnh trên mây Cloudinary
    try {
        // Tách lấy public_id (VD từ URL: https://.../upload/v1234/coworking/branchs/file1.jpg -> coworking/branchs/file1)
        const matches = imageUrl.match(/\/v\d+\/(.+?)\.[a-zA-Z0-9]+$/);
        if (matches && matches[1]) {
            await cloudinary.uploader.destroy(matches[1]);
        }
    } catch (cloudErr) {
        console.warn("⚠️ Bỏ qua lỗi xóa ảnh Cloudinary (Có thể ảnh đã bị xóa trước đó):", cloudErr.message);
    }

    // 2. Xóa đường dẫn trong MongoDB
    const branch = await Branch.findOneAndUpdate(
      { _id: branchId, HostID: hostId },
      { $pull: { Images: imageUrl } },
      { new: true }
    );
    if (!branch) return res.status(404).json({ error: "Không tìm thấy cơ sở." });
    return res.json({ message: "Đã xóa ảnh thành công.", branch });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function getHostSpaces(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    const branches = await Branch.find({ $or: [{ HostID: hostId }, { hostID: hostId }] }).select('_id').lean();
    const branchIds = branches.map(b => b._id);

    const spaces = await Space.find({ $or: [{ BranchID: { $in: branchIds } }, { branchID: { $in: branchIds } }] }).lean();
    return res.json({ spaces });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function getBranchSpaces(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    const { branchId } = req.params;
    const branch = await Branch.findOne({ _id: branchId, HostID: hostId }).lean();
    if (!branch) return res.status(404).json({ error: "Chi nhánh không tìm thấy." });
    
    const spaces = await Space.find({ BranchID: branchId }).lean();
    return res.json({ spaces });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function createSpace(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    const { branchId } = req.params;
    const branch = await Branch.findOne({ _id: branchId, HostID: hostId }).lean();
    if (!branch) return res.status(404).json({ error: "Chi nhánh không tồn tại." });

    const images = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => images.push(file.path));
    }

    const space = await Space.create({
      BranchID: branchId,
      HostID: hostId,
      SpaceCode: req.body.id || req.body.spaceCode,
      Name: req.body.name || req.body.id,
      Category: mapCategory(req.body.type),
      PricePerHour: Number(String(req.body.price || "0").replace(/\D/g, "")),
      Status: mapStatus(req.body.status),
      Images: images
    });
    return res.status(201).json(space);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "Mã không gian đã tồn tại." });
    return sendServerError(res, error);
  }
}

async function updateSpace(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    const { spaceId } = req.params;

    const updateData = {
      PricePerHour: req.body.pricePerHour !== undefined ? Number(String(req.body.pricePerHour).replace(/\D/g, "")) : undefined,
      Status: req.body.status || undefined,
      Name: req.body.name || undefined,
    };

    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((file) => file.path);
      const space = await Space.findOneAndUpdate(
        { _id: spaceId, HostID: hostId },
        { $set: updateData, $push: { Images: { $each: newImages } } },
        { new: true }
      ).lean();
      if (!space) return res.status(404).json({ error: "Không gian không tìm thấy." });
      return res.json({ message: "Cập nhật không gian thành công.", space });
    }

    const space = await Space.findOneAndUpdate(
      { _id: spaceId, HostID: hostId },
      { $set: updateData },
      { new: true }
    ).lean();

    if (!space) return res.status(404).json({ error: "Không gian không tìm thấy." });
    return res.json({ message: "Cập nhật không gian thành công.", space });
  } catch (error) {
    return sendServerError(res, error);
  }
}

// ==========================================
// CẬP NHẬT LẠI HÀM XÓA ẢNH KHÔNG GIAN (XÓA SẠCH TRÊN CLOUDINARY)
// ==========================================
async function deleteSpaceImage(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    const { spaceId } = req.params;
    const { imageUrl } = req.body;

    // 1. Lọc lấy public_id từ URL và Xóa ảnh trên mây Cloudinary
    try {
        const matches = imageUrl.match(/\/v\d+\/(.+?)\.[a-zA-Z0-9]+$/);
        if (matches && matches[1]) {
            await cloudinary.uploader.destroy(matches[1]);
        }
    } catch (cloudErr) {
        console.warn("⚠️ Bỏ qua lỗi xóa ảnh Cloudinary (Có thể ảnh đã bị xóa trước đó):", cloudErr.message);
    }

    // 2. Xóa đường dẫn trong MongoDB
    const space = await Space.findOneAndUpdate(
      { _id: spaceId, HostID: hostId },
      { $pull: { Images: imageUrl } },
      { new: true }
    );
    if (!space) return res.status(404).json({ error: "Không tìm thấy không gian." });
    return res.json({ message: "Đã xóa ảnh thành công.", space });
  } catch (error) {
    return sendServerError(res, error);
  }
}


async function createBranchAndSpaces(req, res) {
  try {
    const hostId = getHostIdFromToken(req);
    if (!hostId) return res.status(401).json({ error: 'Không tìm thấy Token xác thực.' });

    const { name, address, description, image, spaces } = req.body;

    if (!name || !address) {
      return res.status(400).json({ error: 'Tên và địa chỉ cơ sở là bắt buộc.' });
    }

    const branch = await Branch.create({
      HostID: hostId,
      Name: name,
      Address: address,
      Description: description || "",
      Images: image ? [image] : [],
      Status: 'active'
    });

    const createdSpaces = [];
    if (spaces && Array.isArray(spaces) && spaces.length > 0) {
      const spaceDocs = spaces.map(sp => ({
        BranchID: branch._id,
        HostID: hostId,
        SpaceCode: sp.id,
        Name: sp.id,
        Category: mapCategory(sp.type),
        PricePerHour: Number(String(sp.price || "0").replace(/\D/g, "")),
        Status: mapStatus(sp.status),
        Images: sp.image ? [sp.image] : []
      }));
      
      const insertedSpaces = await Space.insertMany(spaceDocs);
      createdSpaces.push(...insertedSpaces);
    }

    return res.status(201).json({ message: 'Tạo cơ sở thành công', branch, spaces: createdSpaces });
  } catch (error) {
    return sendServerError(res, error);
  }
}


// ==========================================
// LẤY DANH SÁCH ĐƠN HÀNG HOST (ĐÃ ĐỒNG BỘ LOGIC THANH TOÁN 30/100%)
// ==========================================
async function getHostBookings(req, res) {
  try {
    const currentTime = new Date();
    // Tự động chuyển đơn hết giờ thành completed
    await Booking.updateMany(
      { $or: [{ Status: 'in-use' }, { status: 'in-use' }], $or: [{ EndTime: { $lt: currentTime } }, { endTime: { $lt: currentTime } }] },
      { $set: { Status: 'completed', status: 'completed' } }
    );

    const hostId = getHostIdFromToken(req);
    
    // 1. Lấy danh sách Bookings
    const bookings = await Booking.find({ $or: [{ HostID: hostId }, { hostID: hostId }] })
      .populate({ path: 'CustomerID', select: 'email Email FullName fullName', strictPopulate: false })
      .populate({
        path: 'SpaceID',
        select: 'Name name SpaceName spaceName SpaceCode Space_Code space_code Space_code SpaceCode_code code spaceCode spaceCode',
        populate: { path: 'BranchID', select: 'Name name' }
      })
      .sort({ createdAt: -1 }).lean();

    // 2. TRUY VẤN LỊCH SỬ THANH TOÁN (GOM CẢ PENDING ĐỂ LẤY PAYMENT_TYPE)
    const bookingIds = bookings.map(b => b._id);
    const payments = await PaymentHistory.find({ BookingID: { $in: bookingIds } }).lean();

    // 3. Thuật toán quét chọn % thanh toán cao nhất
    const bookingPercentMap = {};
    payments.forEach(p => {
        const bId = p.BookingID.toString();
        const type = p.PaymentType;

        if (type === 'full_payment' || type === 'remaining_balance') {
            bookingPercentMap[bId] = 100; // Thanh toán full hoặc tất toán nốt là 100%
        } else if (type === 'deposit') {
            // Cọc thì 30% (nếu chưa có lệnh 100%)
            if (bookingPercentMap[bId] !== 100) {
                bookingPercentMap[bId] = 30;
            }
        }
    });

    // 4. Ghép phần trăm vào kết quả trả về cho Frontend
    const result = bookings.map(b => {
        const percentPaid = bookingPercentMap[b._id.toString()] || 0;
        return { ...b, percentPaid };
    });

    return res.json({ bookings: result });
  } catch (error) {
    return sendServerError(res, error);
  }
}
async function confirmBooking(req, res) {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });

    if ((booking.Status || booking.status) !== 'pending') {
      return res.status(400).json({ error: 'Đơn hàng này không ở trạng thái chờ xác nhận.' });
    }

    // 1. Chuyển trạng thái Booking sang 'confirmed'
    await Booking.updateOne({ _id: bookingId }, { $set: { Status: 'confirmed', status: 'confirmed' } });

    // 2. ĐỒNG BỘ TÀI CHÍNH: Quét tất cả biên lai đang 'pending' của đơn này và chuyển thành 'successful'
    try {
      await PaymentHistory.updateMany(
        { BookingID: bookingId, Status: 'pending' },
        { $set: { Status: 'successful', PaidAt: new Date() } }
      );
    } catch (pErr) {
      console.warn('⚠️ Lỗi đồng bộ lịch sử thanh toán (Confirm):', pErr.message);
    }
    
    const hostId = req.user?.id || req.user?._id || req.user?.userId || booking.HostID;
    await logActivity(hostId, 'CONFIRM_BOOKING', 'Booking', booking._id, `Chủ cơ sở đã xác nhận đơn đặt chỗ`, 'success');

    emitBookingUpdate(bookingId, 'confirmed');
    return res.status(200).json({ message: 'Xác nhận đơn hàng thành công.' });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function checkinBooking(req, res) {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });

    if ((booking.Status || booking.status) !== 'confirmed') {
      return res.status(400).json({ error: 'Chỉ có thể nhận phòng với đơn đã được xác nhận.' });
    }

    const total = Number(booking.TotalAmount || booking.totalAmount || 0);
    await Booking.updateOne(
      { _id: bookingId },
      { $set: { Status: 'in-use', status: 'in-use', DepositAmount: total, depositAmount: total, percentagePaid: 100 } }
    );
    
    const hostId = req.user.id || req.user._id || req.user.userId;
    await logActivity(hostId, 'CHECKIN_BOOKING', 'Booking', booking._id, `Chủ cơ sở đã cho khách nhận phòng (Check-in)`, 'info');

    emitBookingUpdate(bookingId, 'in-use');
    return res.status(200).json({ message: 'Nhận phòng thành công. Hệ thống đã ghi nhận thu đủ 100% tiền!' });
  } catch (error) {
    console.error("LỖI CHECK-IN:", error);
    return res.status(500).json({ error: `Chi tiết lỗi Server: ${error.message}` });
  }
}

async function cancelBooking(req, res) {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });

    const currentStatus = booking.Status || booking.status;
    if (currentStatus !== 'pending' && currentStatus !== 'confirmed') {
      return res.status(400).json({ error: 'Chỉ có thể hủy đơn đang chờ hoặc đơn đã xác nhận.' });
    }

    // 1. Chuyển trạng thái Booking sang 'cancelled'
    await Booking.updateOne({ _id: bookingId }, { $set: { Status: 'cancelled', status: 'cancelled' } });
    
    // 2. ĐỒNG BỘ TÀI CHÍNH: Chuyển toàn bộ biên lai liên quan thành 'refunded' (Đã hoàn tiền)
    try {
      await PaymentHistory.updateMany(
        { BookingID: bookingId },
        { $set: { Status: 'refunded' } }
      );
    } catch (pErr) {
      console.warn('⚠️ Lỗi đồng bộ lịch sử thanh toán (Cancel):', pErr.message);
    }

    const hostId = getHostIdFromToken(req) || booking.HostID;
    await logActivity(hostId, 'CANCEL_BOOKING', 'Booking', booking._id, `Chủ cơ sở đã huỷ đơn đặt chỗ`, 'danger');

    emitBookingUpdate(bookingId, 'cancelled');
    return res.status(200).json({ message: 'Đã hủy đơn hàng thành công.' });
  } catch (error) {
    return sendServerError(res, error);
  }
}

module.exports = {
  renderDashboardView,
  getDashboardStatsAPI,
  getProfileAPI,
  updateProfileAPI,
  getHostBranches,
  createBranch,
  updateBranch,
  deleteBranchImage,
  getHostSpaces,
  getBranchSpaces,
  createSpace,
  updateSpace,
  deleteSpaceImage,
  createBranchAndSpaces,
  getHostReportsPage,
  getHostBookings,
  confirmBooking,
  checkinBooking,
  cancelBooking
};