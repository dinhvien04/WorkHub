# WorkHub MVC

WorkHub là một ứng dụng đặt chỗ Co-working Space xây dựng theo kiến trúc MVC với Node.js, Express, EJS và MongoDB.

## Mô tả dự án

Ứng dụng cho phép:
- Khách hàng tìm kiếm, xem chi tiết, thanh toán và quản lý lịch sử đặt chỗ.
- Chủ cơ sở quản lý cơ sở, không gian, booking và báo cáo.
- Sử dụng Giao diện người dùng động với EJS và JavaScript phía client.

## Yêu cầu hệ thống

- Node.js 18.x hoặc mới hơn
- npm 10.x hoặc mới hơn
- MongoDB (hoặc MongoDB Atlas) để kết nối cơ sở dữ liệu

## Cài đặt

1. Clone repository:
   ```bash
   git clone <repository-url>
   cd projectcnltud
   ```

2. Cài đặt dependencies:
   ```bash
   npm install
   ```

3. Tạo file `.env` từ mẫu `.env.example`:
   ```bash
   cp .env.example .env
   ```
   Hoặc trên Windows PowerShell:
   ```powershell
   copy .env.example .env
   ```

4. Cập nhật giá trị môi trường trong `.env`:
   - `PORT`
   - `MONGODB_URI`
   - `NODE_ENV`

## Cấu trúc file chính

- `server.js` - Entry point của ứng dụng.
- `config/db.js` - Kết nối MongoDB.
- `routes/` - Định nghĩa route.
- `controllers/` - Xử lý logic backend.
- `models/` - Định nghĩa schema Mongoose.
- `views/` - Template EJS.
- `public/` - Tài nguyên front-end tĩnh (CSS, JS).

## Chạy ứng dụng

### Chạy một lần
```bash
node server.js
```

### Chạy trong môi trường phát triển
Nếu bạn dùng `nodemon`, cài thêm:
```bash
npm install -D nodemon
```
```bash
npx nodemon server.js
```

### Truy cập
Mở trình duyệt và vào:
```
http://localhost:3000
```

## Lưu ý

- Không đẩy file `.env` lên GitHub.
- Nếu sử dụng MongoDB Atlas, đảm bảo chuỗi kết nối (`MONGODB_URI`) hợp lệ và cho phép IP của bạn truy cập.
