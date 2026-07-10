const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // Load các biến môi trường từ file .env lên đầu tiên

const { connectDB } = require('./config/db');
const User = require('./models/User');

// --- Import Routes ---
const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const hostRoutes = require('./routes/hostRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require("./routes/paymentRoutes"); 

// --- Import Controllers & Middlewares ---
const { getHostReportsPage } = require('./controllers/hostController'); // Của Gia-Hung
const { verifyToken } = require('./middlewares/authMiddleware'); // Của Gia-Hung

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// ==========================================
// CẤU HÌNH SOCKET.IO
// ==========================================
global.io = io; 
io.on('connection', (socket) => {
    console.log('Một thiết bị vừa kết nối:', socket.id);
    socket.on('disconnect', () => { console.log('Thiết bị đã ngắt kết nối:', socket.id); });
});

// ==========================================
// MIDDLEWARE XỬ LÝ DỮ LIỆU & TĨNH
// ==========================================
// Mở rộng giới hạn payload để tránh lỗi 413 Payload Too Large khi upload ảnh
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));

// ==========================================
// KHAI BÁO ROUTES API
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/hosts', hostRoutes);
app.use('/api/admin', adminRoutes);

// ==========================================
// CẤU HÌNH VIEW ENGINE (EJS)
// ==========================================
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');

// Middleware hỗ trợ EJS
app.use((req, res, next) => {
    res.locals.req = req;
    res.locals.branches = [];
    res.locals.keyword = "";
    next();
});

// ==========================================
// MIDDLEWARE BẢO MẬT (HOST)
// ==========================================
async function requireHostAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization || req.headers.cookie?.match(/(?:^|;\s*)token=([^;]+)/)?.[1];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

        if (!token) return res.redirect("/login");

        const decoded = jwt.verify(token, process.env.JWT_SECRET || "workhub_fallback_secret_key_2026");
        const user = await User.findById(decoded.userId).lean();
        
        if (!user || user.Role !== 'host') return res.redirect("/login");

        req.currentUser = user;
        next();
    } catch (err) {
        return res.redirect("/login");
    }
}

// ==========================================
// KHAI BÁO WEB ROUTES (Render Giao diện EJS)
// ==========================================

// --- Luồng Đăng nhập / Đăng ký ---
app.get('/login', (req, res) => res.render('customer/login'));
app.get('/register', (req, res) => res.render('customer/register'));

// --- Luồng Chủ cơ sở (Host) - Đã được bảo vệ ---
app.use("/host", requireHostAuth, paymentRoutes); 

app.get('/host/profile', requireHostAuth, (req, res) => res.render('host/profile', { currentUser: req.currentUser, scripts: '<script src="/js/host-spaces.js"></script>' }));
app.get('/host/dashboard', requireHostAuth, (req, res) => res.render('host/dashboard', { currentUser: req.currentUser, scripts: '<script src="/js/host-spaces.js"></script>' }));
app.get('/host/spaces', requireHostAuth, (req, res) => res.render('host/spaces', { currentUser: req.currentUser, scripts: '<script src="/js/host-spaces.js"></script>' }));
app.get('/host/bookings', requireHostAuth, (req, res) => res.render('host/bookings', { currentUser: req.currentUser, scripts: '<script src="/js/host-spaces.js"></script>' }));
// Tích hợp controller của Gia-Hung nhưng dùng màng chắn bảo vệ của HEAD:
app.get('/host/reports', requireHostAuth, getHostReportsPage);
app.get('/host/payments', requireHostAuth, (req, res) => res.render('host/payments', { currentUser: req.currentUser, scripts: '<script src="/js/host-spaces.js"></script>' }));

// --- Luồng Admin ---
app.get('/admin/dashboard', (req, res) => res.render('admin/dashboard', { scripts: '<script src="/js/admin-main.js"></script>' }));
app.get('/admin/users', (req, res) => res.render('admin/users', { scripts: '<script src="/js/admin-main.js"></script>' }));
app.get('/admin/hosts', (req, res) => res.render('admin/hosts', { scripts: '<script src="/js/admin-main.js"></script>' }));
app.get('/admin/activitylog', (req, res) => res.render('admin/activitylog', { scripts: '<script src="/js/admin-main.js"></script>' }));

// --- Luồng Khách hàng (Customer) ---
// Định tuyến toàn bộ request còn lại vào customerRoutes
app.use('/', customerRoutes);

// ==========================================
// MIDDLEWARE XỬ LÝ LỖI TOÀN CỤC 
// ==========================================
app.use((err, req, res, next) => {
  console.error("❌ Lỗi server:", err);
  res.status(err.status || 500).json({
    status: "error",
    message: err.message || "Đã xảy ra lỗi server",
  });
});

// ==========================================
// KẾT NỐI CƠ SỞ DỮ LIỆU & KHỞI ĐỘNG SERVER
// ==========================================
connectDB()
    .then(() => {
        server.listen(PORT, () => {
            console.log(`🚀 WorkHub Server đang chạy tại: http://localhost:${PORT}`);
        });
    })
    .catch(err => {
        console.error('❌ Lỗi kết nối DB không thể khởi động Server:', err);
        process.exit(1);
    });

module.exports = app;