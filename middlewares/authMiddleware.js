const jwt = require('jsonwebtoken');

// Hàm hỗ trợ phân tích cookie từ nhánh Gia-Hung
function parseCookies(cookieHeader = '') {
    return cookieHeader.split(';').reduce((cookies, cookieString) => {
        const [name, ...rest] = cookieString.trim().split('=');
        if (!name) return cookies;
        cookies[name] = decodeURIComponent(rest.join('='));
        return cookies;
    }, {});
}

/**
 * 1. Xác thực người dùng (Kiểm tra Token)
 * Kết hợp sự chặt chẽ của nhánh HEAD và khả năng đọc Cookie của nhánh Gia-Hung
 */
const verifyToken = (req, res, next) => {
    try {
        // Lấy token từ header 'Authorization'
        const authHeader = req.header('Authorization') || req.headers['authorization'];
        let tokenFromHeader = null;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            tokenFromHeader = authHeader.split(' ')[1];
        } else if (authHeader) {
            tokenFromHeader = authHeader.split(' ')[1] || authHeader;
        }

        // Lấy token từ Cookie
        const cookies = parseCookies(req.headers.cookie || '');
        const tokenFromCookie = cookies.authToken || cookies.token;

        // Ưu tiên Header, nếu không có thì lấy từ Cookie
        const token = tokenFromHeader || tokenFromCookie;

        if (!token) {
            return res.status(401).json({ 
                error: 'Không tìm thấy token xác thực. Vui lòng cung cấp Bearer Token hoặc đăng nhập để cấp Cookie.' 
            });
        }

        // Sử dụng secret từ .env, có fallback để tránh crash server
        const secret = process.env.JWT_SECRET || 'workhub_fallback_secret_key_2026';

        // Giải mã token
        const decoded = jwt.verify(token, secret);

        // Gắn thông tin đã giải mã vào req.user 
        req.user = decoded;

        // Cho phép request đi tiếp vào Controller
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token đã hết hạn. Vui lòng đăng nhập lại.' });
        }
        return res.status(403).json({ error: 'Token không hợp lệ.' });
    }
};

/**
 * 2. Phân quyền động (Kiểm tra Role)
 * Dùng để đảm bảo quyền truy cập chéo (Ví dụ: authorizeRole('customer', 'host'))
 */
const authorizeRole = (...allowedRoles) => {
    return (req, res, next) => {
        // Chưa đăng nhập hoặc chưa có thông tin user
        if (!req.user) {
            return res.status(401).json({
                error: 'Bạn cần đăng nhập để thực hiện thao tác này.'
            });
        }

        // Không có thông tin role
        if (!req.user.role) {
            return res.status(403).json({
                error: 'Không tìm thấy thông tin phân quyền.'
            });
        }

        // Role không được phép
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Bạn không có quyền truy cập tài nguyên này.'
            });
        }

        next();
    };
};

/**
 * 3. Phân quyền Admin cụ thể
 * Giữ lại để đảm bảo các file như adminRoutes.js không bị lỗi nếu đang gọi hàm này
 */
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Quyền truy cập bị từ chối. Chỉ Admin mới được thực hiện hành động này.' });
    }
    next();
};

module.exports = {
    verifyToken,
    authorizeRole,
    requireAdmin
};