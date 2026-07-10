const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
// Lưu ý: Đảm bảo tên file trong thư mục models của bạn khớp với 2 dòng require này
const CustomerProfile = require('../models/Customer_Profile'); 
const HostProfile = require('../models/Host_Profile');
const logActivity = require('../utils/auditLogger');

// ================= CÁC HÀM HỖ TRỢ (HELPERS) =================
function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
    const e = normalizeEmail(email);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isValidPassword(password) {
    const p = String(password || '');
    return p.length >= 6 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

function sendServerError(res, error) {
    console.error('AuthController error:', error);
    if (error?.stack) console.error(error.stack);
    return res.status(500).json({ error: error?.message || 'Lỗi máy chủ, vui lòng thử lại sau.' });
}

// ================= LOGIC ĐĂNG KÝ  =================
async function registerUser(req, res) {
    try {
        // Hứng cả 'phone' và 'hotline' để đảm bảo Frontend của ai gửi lên cũng nhận được dữ liệu.
        const { email, password, fullName, role, companyName, taxCode, phone, hotline, bankName, bankNumber } = req.body;
        const contactPhone = phone || hotline; // Ưu tiên lấy biến nào có dữ liệu

        // 1. KIỂM TRA ĐẦU VÀO CƠ BẢN
        if (!email || !password || !fullName || !contactPhone) {
            return res.status(400).json({ error: 'Vui lòng nhập đầy đủ Email, Mật khẩu, Họ tên và Số điện thoại!' });
        }
        
        if (!isValidEmail(email)) return res.status(400).json({ error: 'Định dạng email không hợp lệ!' });
        if (!isValidPassword(password)) return res.status(400).json({ error: 'Mật khẩu phải >= 6 ký tự, bao gồm cả chữ và số!' });

        const normalizedEmail = normalizeEmail(email);
        const normalizedRole = String(role || '').trim().toLowerCase();

        if (!['customer', 'host'].includes(normalizedRole)) {
            return res.status(400).json({ error: 'Role không hợp lệ.' });
        }
        // 2. KIỂM TRA ĐẦU VÀO RIÊNG CỦA HOST (Validate TRƯỚC KHI tạo User để tối ưu)
        if (normalizedRole === 'host') {
            if (!companyName || !taxCode || !bankName || !bankNumber) {
                return res.status(400).json({ error: 'Host bắt buộc nhập Tên công ty, Mã số thuế và Thông tin ngân hàng!' });
            }
            // Multer xử lý thành công sẽ nạp dữ liệu vào req.file
            if (!req.file) { 
                return res.status(400).json({ error: 'Vui lòng tải lên Giấy phép kinh doanh!' });
            }
        }
        // 3. KIỂM TRA EMAIL TRÙNG LẶP
        const existingUser = await User.findOne({ Email: normalizedEmail });
        if (existingUser) {
            return res.status(400).json({ error: 'Email này đã được đăng ký!' });
        }
        // 4. MÃ HÓA MẬT KHẨU VÀ TẠO USER
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(String(password), salt);

        const user = await User.create({
            Email: normalizedEmail,
            PasswordHash: passwordHash,
            FullName: String(fullName).trim(),
            Role: normalizedRole,
            Status: 'active'
        });

        // 5. TẠO PROFILE TƯƠNG ỨNG
        if (normalizedRole === 'host') {
            await HostProfile.create({
                UserID: user._id,
                CompanyName: String(companyName).trim(),
                TaxCode: String(taxCode).trim(), 
                VerificationDocument: req.file.path, // Đường link URL từ Cloudinary tự động được lưu tại đây
                Logo: "",
                Hotline: String(contactPhone).trim(),
                IsVerified: false,
                BankName: String(bankName).trim(),
                BankNumber: String(bankNumber).trim()
            });
        } else {
            await CustomerProfile.create({
                UserID: user._id,
                Avatar: "",
                Phone: String(contactPhone).trim(),
                Description: "",
                JobTitle: "",
                Company: "",
                BankName: String(bankName || '').trim(),
                BankNumber: String(bankNumber || '').trim()
            });
        }
        
        await logActivity(
            user._id, // ID của người vừa đăng nhập/đăng ký
            'REGISTER_USER',  // Mã hành động
            'USER',   // Đối tượng bị tác động
            user._id, // ID của tài khoản
            `Tài khoản ${user.FullName} vừa đăng ký mới trên hệ thống`, 
            'success'
        );
        
        // 6. Trả về kết quả
        return res.status(201).json({ 
            message: 'Đăng ký thành công.', 
            user: { 
                id: user._id,
                email: user.Email,
                fullName: user.FullName,
                role: user.Role,
                status: user.Status
            } 
        });

    } catch (error) {
        return sendServerError(res, error);
    }
}

// ================= LOGIC ĐĂNG NHẬP =================
async function loginUser(req, res) {
    try {
        const { email, password } = req.body;
        
        // 1. Kiểm tra đầu vào
        if (!email || !password) {
            return res.status(400).json({ error: 'Email và mật khẩu là bắt buộc.' });
        }

        const normalizedEmail = normalizeEmail(email); 
        
        // 2. Tìm user theo Email
        const user = await User.findOne({ Email: normalizedEmail });
        
        // 🔒 Bảo mật: Tuyệt đối không báo lỗi chi tiết là "sai email" hay "sai password"
        if (!user) {
            return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không chính xác.' });
        }

        // Chặn tài khoản nếu đang bị khóa
        if (user.Status === 'banned') {
            return res.status(403).json({ error: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.' });
        }

        // 3. So sánh mật khẩu bằng hàm băm
        const isMatch = await bcrypt.compare(String(password), user.PasswordHash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không chính xác.' });
        }

        // 4. Ký phát JWT Token
        const payload = {
            userId: user._id,
            role: user.Role
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET || 'workhub_fallback_secret_key_2026',
            { expiresIn: '1d' }
        );
        
        // Ghi log hoạt động từ nhánh HEAD
        await logActivity(user._id, 'LOGIN', 'User', user._id, `Tài khoản ${user.FullName || user.Email} vừa đăng nhập hệ thống`, 'info');
        
        // Gửi cookie tự động để browser có thể dùng cho các route render server-side từ nhánh Gia-Hung
        res.cookie('authToken', token, {
            path: '/',
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: true,
            sameSite: 'lax'
        });

        // 5. Trả về kết quả cho Frontend
        return res.status(200).json({
            message: 'Đăng nhập thành công.',
            token: token,
            user: {
                id: user._id,
                email: user.Email,
                fullName: user.FullName,
                role: user.Role,
                status: user.Status
            }
        });
    } catch (error) {
        return sendServerError(res, error);
    }
}

// ================= LOGIC ĐĂNG XUẤT =================
function logoutUser(req, res) {
    res.clearCookie('authToken');
    return res.json({ message: 'Đăng xuất thành công.' });
}

// ================= LOGIC ĐỔI MẬT KHẨU =================
async function changePassword(req, res) {
    try {
        const { oldPassword, newPassword } = req.body;

        // 1. Kiểm tra userId từ verifyToken truyền sang
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Phiên làm việc hết hạn, vui lòng đăng nhập lại!' });
        }

        // 2. Validate dữ liệu đầu vào
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: 'Vui lòng nhập đầy đủ mật khẩu cũ và mật khẩu mới!' });
        }

        // 3. Tìm User trong Database
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'Tài khoản không tồn tại trên hệ thống!' });
        }

        // 4. Kiểm tra mật khẩu cũ
        const isMatch = await bcrypt.compare(String(oldPassword), user.PasswordHash);
        if (!isMatch) {
            return res.status(400).json({ error: 'Mật khẩu cũ không chính xác!' });
        }

        // 5. Tiến hành mã hóa mật khẩu mới
        const salt = await bcrypt.genSalt(10);
        const newPasswordHash = await bcrypt.hash(String(newPassword), salt);

        // 6. CẬP NHẬT TRỰC TIẾP XUỐNG MONGOOSE TRÁNH BỊ HOOK BYPASS
        const updateResult = await User.updateOne(
            { _id: userId },
            { $set: { PasswordHash: newPasswordHash } }
        );

        console.log("-> Kết quả cập nhật mật khẩu DB:", updateResult);

        if (updateResult.modifiedCount === 0) {
            return res.status(500).json({ error: 'Mật khẩu mới trùng mật khẩu cũ hoặc lỗi hệ thống không thể ghi đè!' });
        }

        return res.status(200).json({
            message: 'Cập nhật mật khẩu thành công!'
        });

    } catch (error) {
        return sendServerError(res, error);
    }
}

// ================= BỘ NHỚ TẠM LƯU MÃ OTP MÔ PHỎNG ("Quên mật khẩu?" ở trang Đăng nhập) =================
// Lưu cấu trúc dạng: { "email@gmail.com": { otp: "123456", expires: 17189012345 } }
const otpCache = {};

// Bước 1: Kiểm tra Email và Sinh mã OTP in ra Console
async function forgotPassword(req, res) {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Vui lòng nhập Email!' });

        const normalizedEmail = normalizeEmail(email);
        
        // Kiểm tra xem email có tồn tại trên hệ thống không
        const user = await User.findOne({ Email: normalizedEmail });
        if (!user) {
            return res.status(404).json({ error: 'Email này không tồn tại trong hệ thống!' });
        }

        // Sinh mã OTP ngẫu nhiên gồm 6 chữ số
        const generatedOtp = String(Math.floor(100000 + Math.random() * 900000));
        
        // Lưu mã OTP vào bộ nhớ tạm, hết hạn sau 5 phút
        otpCache[normalizedEmail] = {
            otp: generatedOtp,
            expires: Date.now() + 5 * 60 * 1000 
        };

        // KỸ THUẬT MOCKING: In mã OTP ra màn hình Terminal của Nhóm trưởng
        console.log('\n======================================================');
        console.log(`🔥 [MOCK OTP] YÊU CẦU QUÊN MẬT KHẨU TỪ: ${normalizedEmail}`);
        console.log(`🔑 MÃ OTP XÁC THỰC CỦA BẠN LÀ: ${generatedOtp}`);
        console.log('======================================================\n');

        return res.status(200).json({ 
            message: 'Mã xác nhận OTP đã được gửi hệ thống (Hãy kiểm tra Terminal máy chủ)!' 
        });

    } catch (error) {
        return sendServerError(res, error);
    }
}

// Bước 2: Xác thực mã OTP và Tiến hành cập nhật mật khẩu mới
async function resetPassword(req, res) {
    try {
        const { email, otp, newPassword } = req.body;

        if (!email || !otp || !newPassword) {
            return res.status(400).json({ error: 'Vui lòng điền đầy đủ tất cả các trường!' });
        }
        if (!isValidPassword(newPassword)) {
            return res.status(400).json({ error: 'Mật khẩu mới phải >= 6 ký tự, bao gồm cả chữ và số!' });
        }

        const normalizedEmail = normalizeEmail(email);
        const cachedData = otpCache[normalizedEmail];

        // 1. Kiểm tra mã OTP xem có hợp lệ hoặc hết hạn chưa
        if (!cachedData) {
            return res.status(400).json({ error: 'Không tìm thấy yêu cầu đổi mật khẩu hoặc mã đã hết hạn!' });
        }
        if (Date.now() > cachedData.expires) {
            delete otpCache[normalizedEmail]; // Xóa mã hết hạn
            return res.status(400).json({ error: 'Mã OTP đã hết hạn 5 phút, vui lòng lấy mã mới!' });
        }
        if (cachedData.otp !== String(otp).trim()) {
            return res.status(400).json({ error: 'Mã OTP nhập vào không chính xác!' });
        }

        // 2. Tiến hành mã hóa mật khẩu mới và lưu vào DB
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(String(newPassword), salt);

        await User.findOneAndUpdate(
            { Email: normalizedEmail },
            { $set: { PasswordHash: passwordHash } }
        );

        // 3. Đổi mật khẩu thành công -> Xóa mã OTP khỏi bộ nhớ tạm
        delete otpCache[normalizedEmail];

        return res.status(200).json({ message: 'Đổi mật khẩu thành công! Vui lòng đăng nhập lại.' });

    } catch (error) {
        return sendServerError(res, error);
    }
}

module.exports = {
    registerUser,
    loginUser,
    logoutUser,
    changePassword,
    forgotPassword,
    resetPassword
};