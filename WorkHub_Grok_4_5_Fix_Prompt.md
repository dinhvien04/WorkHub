# PROMPT CHO GROK 4.5 — SỬA TOÀN DIỆN DỰ ÁN WORKHUB

## 1. Vai trò của bạn

Bạn là **Senior Backend Engineer + Application Security Engineer + Software Architect**.

Nhiệm vụ của bạn là trực tiếp đọc, sửa, refactor, kiểm thử và hoàn thiện repository sau:

- Repository: `https://github.com/dinhvien04/WorkHub`
- Stack hiện tại:
  - Node.js
  - Express
  - EJS
  - MongoDB/Mongoose
  - JWT
  - Cloudinary
  - Multer
  - Socket.IO
  - ExcelJS

Đây không phải nhiệm vụ chỉ review hoặc giải thích. Bạn phải **thực sự sửa code trong repository**, tạo hoặc cập nhật file cần thiết, chạy kiểm thử và xác minh kết quả.

---

# 2. Mục tiêu tổng quát

Hãy đưa WorkHub từ trạng thái MVP/đồ án sang trạng thái:

- Không còn lỗi truy cập chéo dữ liệu nghiêm trọng.
- Không còn lỗ hổng IDOR/BOLA giữa customer, host và admin.
- Không còn host xem hoặc sửa dữ liệu của host khác.
- Luồng booking và payment nhất quán, có state transition rõ ràng.
- JWT, cookie, logout, banned user và reset password an toàn hơn.
- Không còn DOM XSS rõ ràng từ dữ liệu do người dùng nhập.
- Upload file được giới hạn và xác thực đúng.
- Booking không bị đặt trùng do race condition.
- Code có validation, error handling, test, lint và cấu trúc dễ bảo trì.
- README và `.env.example` phản ánh đúng cách chạy production/development.
- Không để lại TODO giả, code chết, comment merge tạm thời hoặc fallback secret nguy hiểm.

---

# 3. Nguyên tắc bắt buộc khi thực hiện

1. **Không chỉ trả lời bằng lý thuyết.**
   - Hãy chỉnh sửa code thật.
   - Tạo file mới nếu cần.
   - Xóa hoặc thay thế code cũ không an toàn.

2. **Không hỏi lại những câu không cần thiết.**
   - Tự đọc code để hiểu cấu trúc hiện tại.
   - Nếu có nhiều cách triển khai, chọn cách an toàn, đơn giản và phù hợp với stack hiện tại.

3. **Không phá vỡ tính năng đang hoạt động nếu không cần thiết.**
   - Giữ giao diện và nghiệp vụ chính.
   - Nếu đổi endpoint, cập nhật cả frontend tương ứng.
   - Nếu đổi schema, thêm migration hoặc script tương thích dữ liệu cũ khi cần.

4. **Không giữ fallback secret trong code.**
   - Không dùng:
     ```js
     process.env.JWT_SECRET || "fallback-secret"
     ```
   - Thiếu secret thì ứng dụng phải fail fast khi khởi động.

5. **Không tin dữ liệu từ client.**
   - Không tin `userId`, `hostId`, `role`, `amount`, `status`, `HostID`, `CustomerID` do client gửi.
   - Identity phải lấy từ token/session đã xác thực.
   - Giá tiền phải tính tại server từ dữ liệu DB.

6. **Mọi endpoint truy cập object theo ID phải kiểm tra ownership.**
   - Customer chỉ được đọc/sửa booking/profile/payment/review của chính mình.
   - Host chỉ được đọc/sửa branch/space/booking/payment thuộc host đó.
   - Admin mới được truy cập dữ liệu toàn hệ thống.

7. **Không dùng mass assignment.**
   - Không dùng trực tiếp:
     ```js
     { $set: req.body }
     ```
   - Chỉ whitelist field được phép cập nhật.

8. **Không dùng `innerHTML` với dữ liệu do người dùng nhập.**
   - Dùng `textContent`, DOM API, template escaping hoặc sanitization phù hợp.

9. **Mọi thay đổi quan trọng phải có test.**
   - Ít nhất có integration test cho authorization và booking/payment.

10. **Hoàn tất đến mức chạy được.**
    - Chạy lint.
    - Chạy test.
    - Chạy ứng dụng hoặc kiểm tra startup.
    - Báo rõ file đã đổi và kết quả kiểm thử.

---

# 4. Quy trình làm việc bắt buộc

Thực hiện theo thứ tự:

## Bước 1 — Đọc toàn bộ dự án

Đọc tối thiểu:

- `server.js`
- `package.json`
- `.env.example`
- `config/`
- `middlewares/`
- `routes/`
- `controllers/`
- `models/`
- `public/js/`
- `views/`
- `utils/`

Tìm thêm các nơi sử dụng:

- `JWT_SECRET`
- `localStorage`
- `document.cookie`
- `innerHTML`
- `findById`
- `findOneAndUpdate`
- `updateMany`
- `req.params.userId`
- `req.body`
- `PaymentHistory`
- `Booking`
- `Cloudinary`
- `multer`
- `Status`
- `status`
- `HostID`
- `hostID`
- `CustomerID`
- `customerID`

## Bước 2 — Lập kế hoạch sửa nội bộ

Tự lập danh sách file phải sửa, nhưng không dừng lại để hỏi xác nhận.

## Bước 3 — Sửa theo thứ tự P0, P1, P2

Không làm đẹp code trước khi đóng các lỗ hổng P0.

## Bước 4 — Viết test

Phải có test chứng minh các lỗi truy cập chéo không còn xảy ra.

## Bước 5 — Chạy kiểm thử và sửa lỗi phát sinh

Không kết thúc khi code chưa chạy hoặc test chưa qua.

## Bước 6 — Cập nhật tài liệu

Cập nhật README, `.env.example`, scripts và hướng dẫn chạy.

---

# 5. P0 — CÁC LỖI PHẢI SỬA NGAY

---

## P0.1 — Customer IDOR/BOLA qua `:userId`

### Hiện trạng

Nhiều route customer nhận `:userId` từ URL và chỉ kiểm tra role `customer`, nhưng không kiểm tra ID đó có trùng với user trong token hay không.

Các route cần kiểm tra gồm những route tương tự:

```js
router.post('/:userId/bookings', verifyToken, createBooking);
router.get('/:userId/profile', protectCustomer, getCustomerProfile);
router.put('/:userId/profile', protectCustomer, updateCustomerProfile);
router.get('/:userId/bookings', protectCustomer, getCustomerBookings);
router.post('/:userId/bookings/:bookingId/review', protectCustomer, submitReview);
router.put('/:userId/bookings/:bookingId/cancel', protectCustomer, cancelBooking);
router.put('/:userId/bookings/:bookingId/pay', protectCustomer, payRemainder);
```

Trong controller hiện có kiểu:

```js
const customerId = req.params.userId || req.user.userId;
```

Đây là lỗi nghiêm trọng vì customer A có thể thay `userId` thành customer B.

### Yêu cầu sửa

1. Bỏ `userId` khỏi URL đối với API của chính người dùng.
2. Dùng route dạng:

```text
POST /api/customers/me/bookings
GET  /api/customers/me/profile
PUT  /api/customers/me/profile
GET  /api/customers/me/bookings
POST /api/customers/me/bookings/:bookingId/review
PUT  /api/customers/me/bookings/:bookingId/cancel
PUT  /api/customers/me/bookings/:bookingId/pay
```

3. Trong controller chỉ lấy:

```js
const customerId = req.user.userId;
```

4. Mọi truy vấn booking phải có ownership:

```js
{
  _id: bookingId,
  CustomerID: customerId
}
```

5. Cập nhật toàn bộ frontend đang gọi endpoint cũ.
6. Có thể giữ endpoint cũ tạm thời chỉ khi:
   - Kiểm tra `req.params.userId === req.user.userId`.
   - Đánh dấu deprecated.
   - Không cho phép truy cập chéo.

### Tiêu chí nghiệm thu

- Customer A không thể xem profile customer B.
- Customer A không thể cập nhật profile customer B.
- Customer A không thể xem booking customer B.
- Customer A không thể hủy, thanh toán hoặc review booking customer B.
- Customer A không thể tạo booking dưới CustomerID của customer B.
- Các trường hợp trên phải trả `403` hoặc `404`, không trả dữ liệu nhạy cảm.

---

## P0.2 — `confirmPayment` không kiểm tra booking thuộc customer hiện tại

### Hiện trạng

`confirmPayment` tìm booking chỉ bằng:

```js
Booking.findById(bookingId)
```

Sau đó tạo `PaymentHistory` cho booking đó.

### Yêu cầu sửa

Phải tìm bằng:

```js
const booking = await Booking.findOne({
  _id: bookingId,
  CustomerID: req.user.userId
});
```

Ngoài ra:

- Chỉ cho tạo payment khi booking ở trạng thái hợp lệ.
- Không cho tạo payment pending trùng loại vô hạn.
- Thêm idempotency hoặc unique constraint phù hợp.
- Không dùng customer ID do client gửi.
- Amount phải tính từ booking và tổng payment `successful`, không tin client.

### Tiêu chí nghiệm thu

- Customer không thể tạo payment cho booking của người khác.
- Gửi lặp request không tạo vô hạn payment trùng.
- Không thể trả số tiền âm hoặc vượt tổng booking.
- Payment pending không được tính là đã thanh toán thành công.

---

## P0.3 — Host có thể thao tác booking của host khác

### Hiện trạng

Các hàm sau chỉ tìm theo `bookingId`:

- `confirmBooking`
- `checkinBooking`
- `cancelBooking`

Ví dụ:

```js
const booking = await Booking.findById(bookingId);
```

### Yêu cầu sửa

Mọi thao tác phải dùng HostID từ token:

```js
const hostId = req.user.userId;

const booking = await Booking.findOne({
  _id: bookingId,
  HostID: hostId
});
```

Tốt hơn, dùng atomic conditional update:

```js
const booking = await Booking.findOneAndUpdate(
  {
    _id: bookingId,
    HostID: hostId,
    Status: 'pending'
  },
  {
    $set: { Status: 'confirmed' }
  },
  {
    new: true,
    runValidators: true
  }
);
```

Không dùng:

```js
req.user?.id || req.user?._id || req.user?.userId || booking.HostID
```

Hãy chuẩn hóa middleware để luôn có:

```js
req.user = {
  userId: "...",
  role: "host"
};
```

### Tiêu chí nghiệm thu

- Host A không thể confirm booking Host B.
- Host A không thể check-in booking Host B.
- Host A không thể cancel booking Host B.
- Không có fallback lấy HostID từ chính booking khi request thiếu identity hợp lệ.
- Test phải chứng minh truy cập chéo bị chặn.

---

## P0.4 — Lỗi hai `$or` trùng key trong `updateMany`

### Hiện trạng

Có code dạng:

```js
await Booking.updateMany(
  {
    $or: [{ Status: 'in-use' }, { status: 'in-use' }],
    $or: [{ EndTime: { $lt: currentTime } }, { endTime: { $lt: currentTime } }]
  },
  {
    $set: {
      Status: 'completed',
      status: 'completed'
    }
  }
);
```

Trong JavaScript, `$or` thứ hai ghi đè `$or` thứ nhất.

### Yêu cầu sửa

1. Chuẩn hóa schema chỉ dùng:
   - `Status`
   - `StartTime`
   - `EndTime`
   - `HostID`
   - `CustomerID`
   - `SpaceID`

2. Sửa thành:

```js
await Booking.updateMany(
  {
    Status: 'in-use',
    EndTime: { $lt: new Date() }
  },
  {
    $set: {
      Status: 'completed'
    }
  }
);
```

3. Không chạy update toàn hệ thống mỗi lần host mở trang.
4. Tạo job riêng:
   - `jobs/completeExpiredBookings.js`
   - Chạy theo cron hoặc interval an toàn.
   - Có lock nếu chạy nhiều instance.
5. Nếu chưa muốn thêm worker, ít nhất đóng gói thành service và chỉ update đúng booking cần thiết.

### Tiêu chí nghiệm thu

- Booking `pending`, `confirmed`, `cancelled` không bị tự động chuyển `completed`.
- Chỉ booking `in-use` và `EndTime < now` mới chuyển `completed`.
- Không còn field lowercase song song trong DB mới.

---

## P0.5 — Host xem được toàn bộ payment toàn hệ thống

### Hiện trạng

Trong `paymentRoutes.js` có:

```js
const payments = await PaymentHistory.find();
```

Điều kiện `HostID` đã bị comment.

### Yêu cầu sửa

1. Chỉ query:

```js
const payments = await PaymentHistory.find({
  HostID: req.currentUser._id
});
```

hoặc chuẩn hóa dùng:

```js
HostID: req.user.userId
```

2. Chỉ populate/select field cần thiết.
3. Không render:
   - PasswordHash
   - BankNumber đầy đủ nếu không cần
   - Dữ liệu host khác
   - Dữ liệu customer không liên quan
4. Có pagination.
5. Có filter server-side.
6. Kiểm tra route `/host/payments` được bảo vệ đúng.

### Tiêu chí nghiệm thu

- Host A chỉ thấy giao dịch có `HostID = Host A`.
- Admin mới xem được toàn bộ.
- Test xác minh không rò rỉ dữ liệu giữa host.

---

## P0.6 — Xóa ảnh Cloudinary trước khi xác minh ownership

### Hiện trạng

`deleteBranchImage` và `deleteSpaceImage` nhận `imageUrl` từ client rồi gọi:

```js
cloudinary.uploader.destroy(publicId)
```

trước khi xác minh branch/space thuộc host hiện tại.

### Yêu cầu sửa

Thứ tự đúng:

1. Lấy host ID từ token.
2. Tìm branch/space bằng:
   ```js
   {
     _id: resourceId,
     HostID: hostId
   }
   ```
3. Kiểm tra ảnh cần xóa thực sự nằm trong mảng `Images`.
4. Không tin `public_id` hoặc URL tùy ý từ client.
5. Nên lưu ảnh dạng:
   ```js
   {
     url: String,
     publicId: String
   }
   ```
6. Chỉ sau khi ownership hợp lệ mới xóa Cloudinary.
7. Nếu Cloudinary xóa thất bại:
   - Không để DB và Cloudinary lệch trạng thái.
   - Có error handling rõ ràng.
8. Nếu cần migration dữ liệu URL cũ, viết script chuyển đổi.

### Tiêu chí nghiệm thu

- Host A không thể xóa ảnh của Host B dù biết URL.
- URL không nằm trong resource phải bị từ chối.
- Không xóa cloud asset trước khi kiểm tra quyền.

---

## P0.7 — JWT fallback secret và `.env.example` nguy hiểm

### Hiện trạng

Có nhiều đoạn:

```js
process.env.JWT_SECRET || 'workhub_fallback_secret_key_2026'
```

`.env.example` chứa một giá trị JWT secret cụ thể.

### Yêu cầu sửa

1. Tạo module config tập trung, ví dụ:
   - `config/env.js`
2. Validate biến môi trường ngay khi startup.
3. Thiếu biến bắt buộc thì throw error và dừng server.
4. Không còn fallback secret ở bất kỳ file nào.
5. `.env.example` chỉ dùng placeholder:

```env
JWT_SECRET=replace_with_a_long_random_secret
MONGODB_URI=mongodb://...
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
NODE_ENV=development
PORT=3000
```

6. Có thể dùng `zod`, `joi`, `envalid` hoặc validation thủ công rõ ràng.
7. Ghi trong README cách tạo secret an toàn:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Tiêu chí nghiệm thu

- Search toàn repo không còn `fallback_secret`, `YOUR_SECRET_KEY` hoặc secret hard-code.
- App không khởi động nếu thiếu `JWT_SECRET`.
- Không log secret.

---

## P0.8 — Token đang lưu ở ba nơi và logout không hoàn chỉnh

### Hiện trạng

Token đang tồn tại ở:

1. Cookie HttpOnly `authToken`.
2. Cookie `token` do JavaScript tự tạo.
3. `localStorage.token`.

Frontend logout chỉ xóa localStorage và cookie `token`, nhưng cookie HttpOnly `authToken` vẫn có thể còn hiệu lực.

### Yêu cầu sửa

Chọn một cơ chế duy nhất:

## Phương án ưu tiên

Dùng JWT trong cookie HttpOnly:

```js
res.cookie('authToken', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 24 * 60 * 60 * 1000
});
```

Các yêu cầu:

1. Không trả token trong JSON login.
2. Không lưu token vào localStorage.
3. Không tự tạo cookie bằng `document.cookie`.
4. Frontend gọi API logout:
   ```http
   POST /api/auth/logout
   ```
5. Server clear cookie cùng option/path:
   ```js
   res.clearCookie('authToken', {
     httpOnly: true,
     secure: process.env.NODE_ENV === 'production',
     sameSite: 'lax',
     path: '/'
   });
   ```
6. Frontend lấy trạng thái đăng nhập từ endpoint:
   ```text
   GET /api/auth/me
   ```
7. Không tin `localStorage.userRole`.
8. Role hiển thị phải lấy từ server.
9. Với request thay đổi dữ liệu dùng cookie, bổ sung CSRF protection phù hợp.
10. Bật CORS đúng nếu frontend/backend khác origin.

### Tiêu chí nghiệm thu

- Sau logout, API private trả 401.
- Không còn JWT trong localStorage.
- Không còn JavaScript đọc/ghi JWT.
- Reload trang không gây trạng thái đăng nhập giả.
- Role không lấy từ localStorage để quyết định quyền thật.

---

## P0.9 — User bị ban vẫn dùng token cũ

### Hiện trạng

Middleware chỉ verify chữ ký JWT, không đọc lại user và không kiểm tra `Status`.

### Yêu cầu sửa

Middleware phải:

1. Verify token.
2. Tìm user theo `decoded.userId`.
3. Chỉ cho qua nếu:
   - User tồn tại.
   - `Status === 'active'`.
   - Role hợp lệ.
4. Gắn object chuẩn hóa:

```js
req.user = {
  userId: user._id.toString(),
  role: user.Role,
  status: user.Status
};
```

5. Sau khi đổi password hoặc admin ban user:
   - Token cũ phải mất hiệu lực.
6. Có thể thêm:
   - `tokenVersion`
   - `passwordChangedAt`
   - session allowlist/revocation
7. JWT payload phải có `tokenVersion`, middleware so sánh với DB.

### Tiêu chí nghiệm thu

- Admin ban user đang đăng nhập thì request tiếp theo bị 401/403.
- Đổi password làm token cũ mất hiệu lực.
- Không cần chờ JWT hết hạn một ngày.

---

# 6. P1 — BẢO MẬT VÀ NGHIỆP VỤ QUAN TRỌNG

---

## P1.1 — Thiết kế lại state machine booking

### Vấn đề

Booking hiện dùng:

```text
pending
confirmed
in-use
completed
cancelled
```

Nhưng payment và booking đang bị trộn logic:

- Confirm booking làm payment pending thành successful.
- Check-in ghi đè DepositAmount thành TotalAmount.
- Booking pending có thể có nhiều payment pending.
- Không phân biệt chờ thanh toán, chờ host duyệt và đã xác nhận.

### Yêu cầu

Thiết kế state transition rõ ràng.

Ví dụ có thể dùng:

```text
pending_payment
payment_submitted
confirmed
in_use
completed
cancelled
```

Hoặc giữ enum cũ nhưng phải có quy tắc rõ ràng.

Tạo service trung tâm:

- `bookingService.createBooking`
- `bookingService.confirmBooking`
- `bookingService.checkInBooking`
- `bookingService.cancelBooking`
- `bookingService.completeBooking`

Không cho controller tự sửa status tùy ý.

Tạo transition map:

```js
const allowedTransitions = {
  pending_payment: ['payment_submitted', 'cancelled'],
  payment_submitted: ['confirmed', 'cancelled'],
  confirmed: ['in_use', 'cancelled'],
  in_use: ['completed'],
  completed: [],
  cancelled: []
};
```

### Tiêu chí nghiệm thu

- Không thể nhảy status trái phép.
- Không thể check-in booking chưa confirmed.
- Không thể complete booking chưa in_use.
- Không thể cancel booking đã completed.
- Tất cả transition có audit log.

---

## P1.2 — Thiết kế lại payment

### Vấn đề

Hiện tại phần trăm thanh toán dựa trên `PaymentType`, không kiểm tra `Status`.

Payment pending/failed/refunded vẫn có thể được tính là đã thanh toán.

### Yêu cầu

1. Tổng tiền đã thanh toán chỉ tính:

```js
{
  Status: 'successful'
}
```

2. Không sửa `DepositAmount` để biểu diễn số đã trả.
3. Tạo helper/service:

```js
getSuccessfulPaidAmount(bookingId)
getRemainingAmount(bookingId)
getPaymentProgress(bookingId)
```

4. Payment status rõ ràng:
   - `pending`
   - `successful`
   - `failed`
   - `refunded`

5. `PaidAt` chỉ set khi chuyển `successful`.
6. Thêm:
   - `VerifiedAt`
   - `VerifiedBy`
   - `FailureReason`
   - `RefundedAt`
   nếu phù hợp.

7. Khi host xác minh payment:
   - Chỉ payment thuộc host đó.
   - Dùng transaction.
   - Không tự động mark tất cả payment pending nếu không đúng nghiệp vụ.

8. Khi hủy booking:
   - Không tự động ghi `refunded` nếu thực tế chưa hoàn tiền.
   - Nên tạo trạng thái `refund_pending` hoặc transaction refund riêng nếu cần.

9. Thêm idempotency key cho thao tác tạo payment:
   - Header `Idempotency-Key`
   - Hoặc unique key theo booking + payment stage.

10. Không cho tổng payment successful vượt `TotalAmount`.

### Tiêu chí nghiệm thu

- Payment pending không được tính là đã trả.
- Payment failed/refunded không được tính là đã trả.
- Không thể trả vượt tổng booking.
- Không thể tạo hai payment cùng giai đoạn do double-click.
- Booking và payment update trong transaction.

---

## P1.3 — Race condition khi đặt phòng

### Vấn đề

Luồng hiện tại:

1. `findOne()` kiểm tra conflict.
2. `Booking.create()`.

Hai request song song có thể cùng vượt qua bước 1.

### Yêu cầu

Chọn giải pháp chắc chắn.

## Phương án ưu tiên: booking slots

Tạo collection/schema slot, ví dụ:

```js
{
  SpaceID,
  BookingID,
  SlotStart
}
```

Unique index:

```js
bookingSlotSchema.index(
  { SpaceID: 1, SlotStart: 1 },
  { unique: true }
);
```

Khi tạo booking:

1. Chuẩn hóa thời gian thành slot 15 hoặc 30 phút.
2. Bắt đầu MongoDB transaction.
3. Tạo booking.
4. Insert toàn bộ slot.
5. Nếu duplicate key, rollback.
6. Commit nếu tất cả thành công.

Khi cancel booking:
- Xóa hoặc giải phóng slot trong transaction.

Nếu không dùng slot, phải có cơ chế lock/transaction đủ mạnh và giải thích rõ tại sao ngăn được phantom race.

### Tiêu chí nghiệm thu

- Hai request đồng thời đặt cùng space và time:
  - Chỉ một request thành công.
  - Request còn lại trả 409.
- Có test concurrency.
- Không dựa hoàn toàn vào “check trước rồi create”.

---

## P1.4 — Luồng forgot password không an toàn

### Vấn đề

Hiện tại:

- OTP sinh bằng `Math.random()`.
- Lưu trong RAM.
- In OTP ra console.
- Trả 404 nếu email không tồn tại.
- Không rate-limit.
- Không giới hạn số lần nhập sai.
- Restart server làm mất OTP.
- Nhiều instance không dùng chung OTP.

### Yêu cầu

1. Không tiết lộ email tồn tại:
   - Luôn trả cùng thông báo.
2. Dùng `crypto.randomBytes()` hoặc OTP cryptographically secure.
3. Không lưu OTP/token dạng plaintext.
4. Lưu hash trong DB hoặc Redis với TTL.
5. Token dùng một lần.
6. Có attempt counter.
7. Có resend cooldown.
8. Có rate limit:
   - Theo IP.
   - Theo account/email normalized.
9. Không log OTP/token.
10. Gửi email thật qua provider hoặc thiết kế adapter email.
11. Nếu chưa cấu hình email ở development:
   - Có mail transport development riêng.
   - Không in token production.
12. Sau reset:
   - Xóa token.
   - Tăng `tokenVersion`.
   - Thu hồi session cũ.
13. Password mới phải validate policy.

### Tiêu chí nghiệm thu

- Response không cho biết email tồn tại.
- Không còn `Math.random()` cho OTP.
- Không còn `otpCache = {}`.
- Không còn log OTP.
- Token hết hạn tự động.
- Brute force bị giới hạn.

---

## P1.5 — DOM XSS qua `innerHTML`

### Vấn đề

Frontend chèn dữ liệu DB bằng template string vào `innerHTML`, ví dụ tên phòng, mô tả, amenities và inline `onclick`.

### Yêu cầu

1. Search toàn bộ:
   - `innerHTML =`
   - `insertAdjacentHTML`
   - inline `onclick`
2. Với dữ liệu người dùng:
   - Dùng `document.createElement`.
   - Dùng `textContent`.
   - Dùng `dataset`.
   - Dùng `addEventListener`.
3. Không đặt dữ liệu user vào inline JS.
4. EJS phải dùng `<%= value %>` thay vì `<%- value %>` nếu không cần raw HTML.
5. Nếu có rich text thật:
   - Dùng DOMPurify phía client hoặc sanitize-html phía server.
6. Thêm Helmet.
7. Cấu hình CSP phù hợp.
8. Dần loại bỏ inline script để CSP không cần `'unsafe-inline'`.
9. Validate URL ảnh chỉ cho phép protocol/domain phù hợp.

### Tiêu chí nghiệm thu

Payload ví dụ:

```html
<img src=x onerror=alert(1)>
```

được hiển thị như text hoặc bị loại bỏ, không chạy JavaScript.

---

## P1.6 — Upload file thiếu giới hạn

### Vấn đề

- JSON/urlencoded limit đang là `50mb`.
- Multer không giới hạn file size.
- PDF được cho phép ở mọi field.
- Chưa kiểm tra MIME đầy đủ.
- Có upload nhiều file.

### Yêu cầu

1. Giảm body limit xuống mức hợp lý:
   - JSON: khoảng `1mb` hoặc thấp hơn.
   - urlencoded: khoảng `1mb`.
2. Multer:
   - Giới hạn file size.
   - Giới hạn số file.
   - Kiểm tra field.
   - Kiểm tra MIME.
3. Avatar/logo/branch/space:
   - Chỉ JPEG, PNG, WebP.
4. Verification document:
   - PDF/JPEG/PNG nếu nghiệp vụ cần.
5. Không dùng filename gốc trực tiếp làm public ID.
6. Dùng random UUID/public ID.
7. Sanitize filename.
8. Xóa file Cloudinary đã upload nếu controller thất bại sau upload.
9. Không cho SVG nếu chưa có sanitizer.
10. Validate dimensions nếu có thể.
11. Đảm bảo folder Cloudinary đúng và thống nhất.

### Tiêu chí nghiệm thu

- Upload file quá lớn trả 413/400.
- Upload PDF vào avatar bị từ chối.
- Upload executable hoặc MIME giả bị từ chối.
- Không để orphan file khi DB operation fail.

---

## P1.7 — Regex injection/ReDoS và query không giới hạn

### Vấn đề

Có nơi tạo regex trực tiếp từ input:

```js
new RegExp(keyword.trim(), 'i')
```

và:

```js
{ $regex: location, $options: 'i' }
```

### Yêu cầu

1. Escape regex input.
2. Giới hạn chiều dài keyword.
3. Pagination cho:
   - users
   - bookings
   - reviews
   - payments
   - branches
   - spaces
   - audit logs
4. Dùng projection/select.
5. Không tải toàn bộ DB rồi filter trong Node nếu có thể query ở MongoDB.
6. Thêm index phù hợp dựa trên query thực tế.
7. Với tìm kiếm text, cân nhắc MongoDB text index hoặc normalized search field.

### Tiêu chí nghiệm thu

- Input regex đặc biệt không gây lỗi hoặc query bất thường.
- Endpoint list có `page`, `limit`, giới hạn max.
- Không còn `find()` toàn collection ở route thường.

---

## P1.8 — CSRF, headers và rate limit

### Yêu cầu

1. Thêm `helmet`.
2. Thêm rate limit:
   - login
   - register
   - forgot password
   - reset password
   - payment submit
   - booking create
3. Vì dùng cookie auth:
   - Thêm CSRF protection hoặc double-submit token.
   - Ít nhất kiểm tra Origin/Referer cho state-changing requests.
4. Cấu hình trust proxy khi deploy sau reverse proxy.
5. Không trả stack trace production.
6. Thêm request ID.
7. Thêm structured logging.

### Tiêu chí nghiệm thu

- Brute-force login bị giới hạn.
- State-changing request thiếu CSRF token bị từ chối.
- Security headers xuất hiện.
- Production response không lộ stack trace.

---

# 7. P2 — REFACTOR VÀ CHẤT LƯỢNG CODE

---

## P2.1 — Chuẩn hóa field name

Hiện code có dấu hiệu dùng song song:

- `Status` và `status`
- `HostID` và `hostID`
- `FullName` và `fullName`
- `SpaceID` và `spaceID`
- `BranchID` và `branchID`

### Yêu cầu

1. Chọn một chuẩn duy nhất theo schema hiện tại, ưu tiên:
   - `Status`
   - `HostID`
   - `CustomerID`
   - `SpaceID`
   - `BranchID`
   - `FullName`
2. Xóa code fallback field lowercase sau khi có migration.
3. Tạo script migration nếu DB cũ có field lowercase.
4. Không tiếp tục lưu cả hai field.

---

## P2.2 — Tách controller quá lớn

Controller hiện tại quá lớn và trộn:

- HTTP handling
- business logic
- database
- Cloudinary
- payment
- audit
- Excel
- Socket.IO

### Yêu cầu

Tách thành cấu trúc hợp lý:

```text
controllers/
services/
repositories/
validators/
policies/
jobs/
utils/
```

Ví dụ:

```text
controllers/bookingController.js
services/bookingService.js
repositories/bookingRepository.js
policies/bookingPolicy.js
validators/bookingValidator.js
jobs/completeExpiredBookings.js
```

Controller chỉ nên:

1. Nhận request.
2. Lấy input đã validate.
3. Gọi service.
4. Trả response.

---

## P2.3 — Validation tập trung

Thêm validation bằng Zod/Joi/express-validator.

Validate tối thiểu:

- ObjectId.
- Email.
- Password.
- Phone.
- Booking start/end.
- Rating 1–5.
- Comment length.
- Branch name/address.
- Space price/capacity.
- Payment type.
- Filter date.
- Pagination.
- File metadata.

Không để Mongoose là lớp validation duy nhất.

---

## P2.4 — Error handling

1. Tạo custom error:
   - `ValidationError`
   - `UnauthorizedError`
   - `ForbiddenError`
   - `NotFoundError`
   - `ConflictError`
2. Tạo async handler wrapper.
3. Global error middleware:
   - Không lộ `error.message` tùy tiện production.
   - Map lỗi Mongoose hợp lý.
   - Xử lý duplicate key.
   - Xử lý invalid ObjectId.
4. Không `console.log` tràn lan.
5. Dùng logger có level.

---

## P2.5 — Transaction cho thao tác nhiều bước

Dùng MongoDB transaction cho:

- Register user + create profile.
- Create branch + spaces.
- Create booking + slots.
- Confirm payment + update booking.
- Cancel booking + release slots.
- Refund state.
- Delete resource + cleanup liên quan nếu cần.

Nếu deployment MongoDB không hỗ trợ transaction, cập nhật README yêu cầu replica set hoặc MongoDB Atlas.

---

## P2.6 — Socket.IO authorization

Hiện Socket.IO phát global:

```js
global.io.emit(...)
```

### Yêu cầu

1. Xác thực socket.
2. Join room theo:
   - user
   - host
   - booking
3. Không broadcast toàn hệ thống.
4. Host chỉ nhận booking update của mình.
5. Customer chỉ nhận update booking của mình.
6. Không dùng `global.io` nếu có thể; inject service rõ ràng.

---

## P2.7 — Audit log

1. Audit log không được làm fail nghiệp vụ chính nếu logger phụ gặp lỗi, nhưng phải ghi nhận được lỗi.
2. Không ghi dữ liệu nhạy cảm:
   - password
   - token
   - bank number đầy đủ
3. Ghi:
   - actor
   - action
   - entity
   - entityId
   - requestId
   - IP
   - timestamp
4. Admin activity log cần pagination và filter.
5. Xác minh TTL phù hợp, không vô tình xóa log cần lưu lâu.

---

## P2.8 — Báo cáo và số liệu tài chính

Hiện báo cáo có xu hướng tính doanh thu từ `Booking.TotalAmount` hoặc `DepositAmount`, không nhất thiết phản ánh payment successful.

### Yêu cầu

1. Phân biệt:
   - GMV
   - successful revenue
   - pending payment
   - refunded amount
   - outstanding amount
2. Doanh thu thực nhận phải lấy từ `PaymentHistory.Status = successful`.
3. Tiền hoàn phải trừ đúng.
4. Không coi booking cancelled là revenue.
5. Timezone phải thống nhất, ưu tiên UTC trong DB và timezone hiển thị riêng.
6. Thêm test cho tổng doanh thu.

---

# 8. TEST BẮT BUỘC

Cài framework test phù hợp, ví dụ:

- Jest hoặc Vitest.
- Supertest.
- mongodb-memory-server hoặc database test riêng.

Tạo test tối thiểu cho các trường hợp sau.

## Authentication

1. Login đúng.
2. Login sai.
3. User banned không login được.
4. User bị ban sau login thì token cũ không dùng được.
5. Logout làm session/token mất hiệu lực.
6. Thiếu JWT secret thì app không startup.
7. Forgot password không tiết lộ email tồn tại.

## Customer authorization

1. Customer A xem profile A thành công.
2. Customer A xem profile B thất bại.
3. Customer A sửa profile B thất bại.
4. Customer A xem booking B thất bại.
5. Customer A cancel booking B thất bại.
6. Customer A pay booking B thất bại.
7. Customer A review booking B thất bại.
8. Customer A tạo booking với CustomerID B thất bại.

## Host authorization

1. Host A xem branch A thành công.
2. Host A sửa branch B thất bại.
3. Host A xóa ảnh branch B thất bại.
4. Host A confirm booking B thất bại.
5. Host A check-in booking B thất bại.
6. Host A cancel booking B thất bại.
7. Host A không thấy payment Host B.

## Booking

1. EndTime phải lớn hơn StartTime.
2. Không đặt trong quá khứ.
3. Không đặt space inactive/maintenance.
4. Hai booking đồng thời cùng slot chỉ một thành công.
5. Booking pending không tự thành completed.
6. Chỉ `in-use + expired` thành completed.

## Payment

1. Pending không tính vào paid amount.
2. Failed không tính vào paid amount.
3. Refunded không tính vào paid amount.
4. Successful được tính đúng.
5. Không trả vượt TotalAmount.
6. Double-submit không tạo duplicate.
7. Host không verify payment của host khác.

## XSS và upload

1. Tên phòng chứa HTML không thực thi.
2. Upload PDF vào avatar bị từ chối.
3. Upload quá size bị từ chối.
4. Host không xóa Cloudinary asset của host khác.

---

# 9. PACKAGE.JSON VÀ TOOLING

Cập nhật `package.json`:

```json
{
  "main": "server.js",
  "scripts": {
    "dev": "nodemon server.js",
    "start": "node server.js",
    "test": "...",
    "test:watch": "...",
    "lint": "...",
    "lint:fix": "...",
    "format": "...",
    "check": "npm run lint && npm test"
  }
}
```

Thêm khi phù hợp:

- eslint
- prettier
- nodemon
- jest/vitest
- supertest
- helmet
- express-rate-limit
- cookie-parser
- csrf library hoặc giải pháp tương đương
- zod/joi/express-validator
- pino/winston
- mongodb-memory-server
- uuid

Không thêm dependency thừa hoặc bỏ mặc dependency không dùng.

Chạy:

```bash
npm install
npm audit
npm run lint
npm test
```

Sửa các lỗi có thể sửa an toàn.

---

# 10. SERVER VÀ STARTUP

Refactor `server.js` để:

1. Load và validate env trước.
2. Tạo app riêng:
   - `app.js`
3. Startup riêng:
   - `server.js`
4. Test có thể import app mà không tự listen.
5. Có:
   - 404 handler
   - global error handler
   - graceful shutdown
   - MongoDB disconnect
   - health endpoint
6. Không dùng `global.io`.
7. Body limit hợp lý.
8. Helmet/rate-limit/cookie parser được cấu hình đúng.
9. Static uploads không lộ file nhạy cảm.

Ví dụ:

```text
GET /health
```

Trả:

```json
{
  "status": "ok"
}
```

Không lộ secret hoặc connection string.

---

# 11. DATABASE VÀ INDEX

Kiểm tra và bổ sung index phù hợp.

Tối thiểu xem xét:

```js
Booking:
{ CustomerID: 1, createdAt: -1 }
{ HostID: 1, createdAt: -1 }
{ SpaceID: 1, StartTime: 1, EndTime: 1 }
{ Status: 1, EndTime: 1 }

PaymentHistory:
{ BookingID: 1, Status: 1 }
{ HostID: 1, Status: 1, createdAt: -1 }
{ CustomerID: 1, createdAt: -1 }

Branch:
{ HostID: 1, createdAt: -1 }

Space:
{ HostID: 1, BranchID: 1 }
{ BranchID: 1, SpaceCode: 1 } unique

Review:
{ BookingID: 1 } unique
{ SpaceID: 1, createdAt: -1 }
```

Không tạo index trùng hoặc dư thừa.

Viết migration/script nếu thay đổi schema đáng kể.

---

# 12. FRONTEND PHẢI ĐƯỢC CẬP NHẬT ĐỒNG BỘ

Sau khi đổi auth và endpoint:

1. Xóa logic decode JWT bằng:

```js
JSON.parse(atob(token.split('.')[1]))
```

2. Xóa token khỏi localStorage.
3. Không lưu role/userId để làm nguồn quyền thật.
4. Dùng `/api/auth/me`.
5. `fetch` dùng:
   ```js
   credentials: 'same-origin'
   ```
   hoặc `include` nếu khác origin.
6. Thêm CSRF token vào request thay đổi dữ liệu.
7. Cập nhật route `/me/...`.
8. Không dùng inline event handler.
9. Không dùng `innerHTML` với dữ liệu user.
10. Xử lý 401 tập trung:
    - chuyển login
    - không loop redirect
11. Logout phải gọi server.

---

# 13. README VÀ TÀI LIỆU

Cập nhật README bao gồm:

1. Tên thư mục clone đúng.
2. Phiên bản Node phù hợp với dependency thật.
3. Cách tạo `.env`.
4. Danh sách biến môi trường.
5. Cách tạo JWT secret.
6. Cách chạy MongoDB.
7. Yêu cầu replica set nếu dùng transaction.
8. Cách chạy development.
9. Cách chạy test.
10. Cách chạy lint.
11. Cách deploy production.
12. Security notes:
    - HTTPS bắt buộc.
    - Không commit `.env`.
    - Rotate secret nếu bị lộ.
13. Mô tả role:
    - customer
    - host
    - admin
14. Mô tả booking/payment states.
15. API endpoint chính.
16. Không để README nói dùng `npm 10` nếu không thực sự bắt buộc.
17. Không để `cd projectcnltud` nếu repo là WorkHub.

---

# 14. DEFINITION OF DONE

Chỉ được coi là hoàn thành khi đáp ứng toàn bộ:

- [ ] Customer không thể truy cập dữ liệu customer khác.
- [ ] Host không thể truy cập/sửa dữ liệu host khác.
- [ ] Host không xem toàn bộ payment.
- [ ] Không còn lỗi duplicate `$or`.
- [ ] Không còn JWT fallback secret.
- [ ] JWT không còn trong localStorage.
- [ ] Logout thực sự vô hiệu phiên.
- [ ] Banned user/token cũ bị chặn.
- [ ] Forgot password không dùng `Math.random()` và RAM cache.
- [ ] Không còn XSS rõ ràng từ `innerHTML`.
- [ ] Ownership được kiểm tra trước khi xóa Cloudinary.
- [ ] Upload có limit và MIME validation.
- [ ] Booking concurrency được chặn.
- [ ] Payment pending/failed/refunded không tính là đã thanh toán.
- [ ] Không thể thanh toán vượt tổng booking.
- [ ] Booking/payment có state transition rõ ràng.
- [ ] Có transaction ở các nghiệp vụ nhiều bước quan trọng.
- [ ] Có pagination ở list lớn.
- [ ] Có validation tập trung.
- [ ] Có Helmet, rate limit và CSRF protection phù hợp.
- [ ] Có test authorization.
- [ ] Có test race condition booking.
- [ ] Có test payment.
- [ ] `npm run lint` thành công.
- [ ] `npm test` thành công.
- [ ] README và `.env.example` đã cập nhật.
- [ ] Không để TODO giả hoặc comment merge tạm thời.
- [ ] Không để dead code, duplicate route hoặc dependency thừa rõ ràng.

---

# 15. ĐỊNH DẠNG KẾT QUẢ CUỐI CÙNG CỦA GROK

Sau khi sửa xong, hãy trả về báo cáo theo đúng cấu trúc sau:

## A. Tóm tắt

- Đã sửa những nhóm lỗi nào.
- Kiến trúc mới thay đổi ra sao.
- Có breaking change nào không.

## B. Danh sách file đã thay đổi

Ví dụ:

```text
server.js
app.js
config/env.js
middlewares/authMiddleware.js
middlewares/csrfMiddleware.js
controllers/customerController.js
services/bookingService.js
services/paymentService.js
routes/customerRoutes.js
public/js/login.js
tests/authorization.test.js
README.md
```

## C. Các lỗi P0 đã đóng

Với mỗi lỗi:

- Lỗi cũ.
- Cách sửa.
- Test tương ứng.

## D. Các thay đổi database

- Schema mới.
- Index mới.
- Migration cần chạy.
- Cách rollback nếu cần.

## E. Kết quả kiểm thử

Ghi rõ kết quả lệnh:

```bash
npm run lint
npm test
npm audit
```

Không được ghi “đã pass” nếu chưa thực sự chạy.

## F. Cách chạy dự án

Ghi lệnh đầy đủ:

```bash
cp .env.example .env
npm install
npm run dev
```

## G. Hạn chế còn lại

Nếu có phần chưa thể hoàn tất, phải ghi chính xác:

- File nào.
- Vì sao.
- Rủi ro.
- Cách xử lý tiếp.

Không được nói chung chung.

---

# 16. YÊU CẦU CUỐI

Bắt đầu bằng việc đọc repository và sửa trực tiếp.

Ưu tiên tuyệt đối:

1. Authorization/ownership.
2. Payment data leak.
3. Booking state corruption.
4. Token/session security.
5. XSS.
6. Cloudinary ownership.
7. Booking concurrency.
8. Tests.
9. Refactor.
10. Documentation.

Không dừng ở review. Không chỉ đưa code mẫu. Hãy hoàn thành thay đổi trong repository, chạy test, sửa lỗi và chỉ kết thúc khi dự án đạt Definition of Done ở trên.
