# PROMPT CHO GROK 4.5 — SỬA CÁC LỖI CÒN LẠI SAU COMMIT HARDENING WORKHUB

## 1. Bối cảnh

Bạn là **Senior Node.js Engineer, Application Security Engineer và Test Engineer**.

Hãy trực tiếp đọc và sửa repository:

- Repository: `https://github.com/dinhvien04/WorkHub`
- Branch mục tiêu: `main`
- Commit cần review và sửa tiếp:
  - SHA: `9b60a9810a134686c5acffd750b8592dcbe5e457`
  - Message: `feat: harden security, booking ownership, and cookie auth`

Dự án sử dụng:

- Node.js
- Express 5
- EJS
- MongoDB/Mongoose
- JWT trong HttpOnly cookie
- CSRF double-submit cookie
- Cloudinary
- Multer
- Socket.IO
- Jest
- Supertest
- mongodb-memory-server

Commit trên đã sửa được nhiều vấn đề quan trọng:

- IDOR customer cơ bản.
- Host thao tác booking của host khác.
- Host xem toàn bộ payment.
- JWT fallback secret.
- HttpOnly cookie.
- `tokenVersion`.
- Forgot password token.
- Booking slot unique index.
- Payment successful-only calculation.
- Helmet.
- Rate limit.
- Một số integration test.

**Không được hoàn tác các phần đã làm đúng.**

Nhiệm vụ hiện tại là sửa toàn bộ lỗi còn sót, regression và test giả được liệt kê trong prompt này.

---

# 2. Mục tiêu

Sau khi hoàn tất:

- Guest vẫn xem được trang chủ, tìm kiếm và chi tiết không gian.
- Không còn API customer bị mount ngoài `/api`.
- Không thể bypass CSRF qua route alias.
- Check availability hoạt động đúng.
- Không còn biến JWT/token legacy trên frontend.
- Không còn DOM XSS rõ ràng.
- Host không xem dashboard của branch host khác.
- Booking slot chặn được mọi khoảng thời gian giao nhau.
- Có giới hạn thời lượng booking.
- Payment có API verify/reject đầy đủ.
- Double-submit payment không tạo giao dịch trùng.
- Host chưa được admin duyệt không dùng được chức năng host.
- Dashboard/report dùng đúng dữ liệu payment.
- Email reset production gửi thật hoặc fail rõ ràng.
- CSP không chặn dependency hợp lệ.
- Test chạy trên code production thật, không test hàm giả.
- GitHub Actions tự động chạy lint và test.

---

# 3. Quy tắc bắt buộc

1. **Sửa code thật, không chỉ giải thích.**
2. Đọc code hiện tại trước khi sửa.
3. Không hỏi xác nhận từng bước.
4. Không bỏ qua test.
5. Không tắt CSRF trong toàn bộ test suite.
6. Không sửa test để “ép xanh” mà không sửa lỗi thật.
7. Không tự định nghĩa hàm giả trong test để mô phỏng code production.
8. Không giữ API trùng ở `/api/...` và `/...`.
9. Không dùng JWT trong `localStorage`.
10. Không dùng biến toàn cục `token`.
11. Không đưa dữ liệu user vào `innerHTML` hoặc inline JavaScript.
12. Không tin `branchId`, `bookingId`, `paymentId` chỉ vì người dùng có role đúng.
13. Mọi object ID phải kiểm tra ownership.
14. Mọi payment transition phải atomic hoặc chống race.
15. Không báo email đã gửi thành công trong production nếu chưa gửi thật.
16. Không được kết thúc trước khi chạy:
    ```bash
    npm ci
    npm run lint
    npm test
    npm audit
    ```
17. Nếu phát hiện thêm lỗi trong quá trình sửa, hãy sửa luôn nếu liên quan trực tiếp.

---

# 4. Đọc các file sau trước

Đọc tối thiểu:

```text
app.js
server.js
package.json
config/env.js

routes/authRoutes.js
routes/customerRoutes.js
routes/hostRoutes.js
routes/paymentRoutes.js
routes/adminRoutes.js

controllers/authController.js
controllers/customerController.js
controllers/hostController.js
controllers/adminController.js

services/bookingService.js
services/paymentService.js
services/emailService.js
services/socketService.js

middlewares/authMiddleware.js
middlewares/csrfMiddleware.js
middlewares/rateLimiters.js
middlewares/upload.js
middlewares/errorHandler.js

models/Booking.js
models/BookingSlot.js
models/Payment_History.js
models/User.js
models/Host_Profile.js
models/Branch.js
models/Space.js

public/js/api.js
public/js/main.js
public/js/login.js
public/js/customer-main.js
public/js/customer-history.js
public/js/host-spaces.js
public/js/host-dashboard.js
public/js/host-profile.js
public/js/admin-main.js

views/layout.ejs
views/partials/layout.ejs

test/auth.test.js
test/authorization.test.js
test/booking.test.js
test/payment.test.js
test/upload-xss.test.js
test/helpers.js
test/setup.js
```

Tìm toàn repository các chuỗi:

```text
app.use('/', customerRoutes)
localStorage.getItem('token')
localStorage.setItem('token')
Bearer ${token}
if (!token)
innerHTML
insertAdjacentHTML
onclick=
onchange=
onerror=
DISABLE_CSRF
branchId
PaymentHistory
DepositAmount
TotalAmount
verifyPayment
Math.floor
BOOKING_SLOT_MINUTES
unsafe-inline
cdnjs.cloudflare.com
```

---

# 5. P0 — Tách customer page router và API router

## Vấn đề

Hiện cùng một `customerRoutes` được mount:

```js
app.use('/api/customers', customerRoutes);
```

và:

```js
app.use('/', customerRoutes);
```

Router này chứa cả page routes và private API.

Điều đó làm API xuất hiện hai lần:

```text
POST /api/customers/me/bookings
POST /me/bookings
```

CSRF middleware hiện chỉ áp dụng cho URL bắt đầu bằng `/api/`.

Vì vậy route ngoài `/api` có thể bypass CSRF.

## Yêu cầu sửa

Tạo hai router riêng:

```text
routes/customerPageRoutes.js
routes/customerApiRoutes.js
```

### `customerPageRoutes.js`

Chỉ chứa page GET:

```text
GET /
GET /search
GET /detail
GET /payment
GET /history
GET /payment_history
GET /profile
```

Các page private phải có page-level auth phù hợp.

### `customerApiRoutes.js`

Chỉ chứa API:

```text
GET  /me/profile
PUT  /me/profile
GET  /me/bookings
POST /me/bookings
POST /me/bookings/:bookingId/review
PUT  /me/bookings/:bookingId/cancel
PUT  /me/bookings/:bookingId/pay
POST /me/booking/confirm

GET  /branch/:branchId/reviews
GET  /bookings/:bookingId/review
GET  /bookings/availability
```

Mount duy nhất:

```js
app.use('/api/customers', customerApiRoutes);
app.use('/', customerPageRoutes);
```

Không mount `customerApiRoutes` tại `/`.

## Route deprecated

Các route `/:userId/...` cũ:

- Có thể xóa hoàn toàn nếu frontend không dùng.
- Nếu cần compatibility tạm thời, chỉ đặt bên dưới `/api/customers`.
- Không bao giờ expose tại root.
- Có warning deprecation.
- Vẫn self-only.

## Test bắt buộc

```text
POST /me/bookings                       => 404
PUT  /me/profile                        => 404
POST /me/booking/confirm                => 404
POST /api/customers/me/bookings no CSRF => 403
POST /api/customers/me/bookings valid CSRF => đi đến auth/business logic
```

---

# 6. P0 — Sửa guest bị redirect login

## Vấn đề

`main.js` gọi:

```js
WorkHubAPI.api('/api/auth/me')
```

trên mọi trang.

`api.js` tự redirect `/login` với mọi response 401.

Guest mở:

```text
/
/search
/detail
```

bị redirect sang login.

## Yêu cầu sửa

Thêm option vào API client:

```js
async function api(url, options = {}) {
  const {
    redirectOn401 = true,
    ...fetchOptions
  } = options;
}
```

Chỉ redirect nếu:

```js
if (res.status === 401 && redirectOn401) {
  ...
}
```

Khi kiểm tra session optional:

```js
const res = await WorkHubAPI.api('/api/auth/me', {
  redirectOn401: false
});
```

401 ở `/api/auth/me` khi guest phải được hiểu là:

```js
user = null;
```

không phải lỗi navigation.

## Test bắt buộc

Dùng Supertest/JSDOM/Playwright tùy thiết kế:

- `GET /` trả 200 khi không có cookie.
- `GET /search` trả 200 khi không có cookie.
- `GET /detail?...` không redirect login chỉ vì guest.
- API client với `redirectOn401: false` không đổi `window.location`.
- Private action vẫn redirect login khi 401.

---

# 7. P0 — Sửa check availability bị CSRF chặn

## Vấn đề

Check availability là thao tác đọc nhưng đang dùng POST:

```text
POST /api/customers/bookings/check-availability
```

Frontend gọi bằng `fetch()` trực tiếp và không gửi CSRF header.

## Yêu cầu ưu tiên

Chuyển thành GET:

```text
GET /api/customers/bookings/availability
```

Query:

```text
branchId
date
timeSlot
roomType
```

Ví dụ controller:

```js
const { branchId, date, timeSlot, roomType } = req.query;
```

GET không cần CSRF.

Frontend phải gọi:

```js
const params = new URLSearchParams({
  branchId,
  date,
  timeSlot: selectedTimeSlot,
  roomType: currentRoomType
});

const res = await WorkHubAPI.api(
  `/api/customers/bookings/availability?${params.toString()}`,
  { redirectOn401: false }
);
```

Không gửi Authorization header.

## Nếu vẫn giữ POST

Phải gọi qua `WorkHubAPI.api()` để tự gửi CSRF.

Tuy nhiên, GET là phương án đúng hơn vì endpoint chỉ đọc.

## Test bắt buộc

- Guest check availability thành công.
- Không cần JWT.
- Không cần CSRF nếu dùng GET.
- Thời gian quá khứ bị từ chối.
- Branch/roomType invalid bị từ chối.
- Không lộ inactive/maintenance spaces.

---

# 8. P0 — Xóa toàn bộ token legacy frontend

## Vấn đề

Frontend còn các đoạn:

```js
const token = localStorage.getItem('token');
Authorization: `Bearer ${token}`;
if (!token) ...
```

Trong khi auth mới dùng HttpOnly cookie.

Một số file có thể dùng biến `token` mà không khai báo, gây:

```text
ReferenceError: token is not defined
```

## Yêu cầu sửa

Search toàn bộ `public/js`.

Xóa:

```text
localStorage.getItem('token')
localStorage.setItem('token')
Authorization: Bearer
if (!token)
token.split('.')
atob(token)
decode JWT client-side
```

Tất cả request phải dùng:

```js
WorkHubAPI.api(...)
```

hoặc helper host gọi vào `WorkHubAPI.api`.

Cookie được browser tự gửi với:

```js
credentials: 'same-origin'
```

Không cần header Authorization.

Có thể giữ code xóa localStorage token cũ trong login/logout như cleanup migration, nhưng không được đọc hoặc dùng nó.

## Test bắt buộc

- Search repo không còn `localStorage.getItem('token')`.
- Search repo không còn `Bearer ${token}`.
- Search repo không còn `if (!token)` cho auth.
- Host bookings tải bằng cookie.
- Xóa branch/space image hoạt động bằng cookie + CSRF.

---

# 9. P0 — Sửa DOM XSS thật sự

## Vấn đề

Frontend còn dùng `innerHTML` với dữ liệu từ DB:

- `space.Name`
- `space.Description`
- `space.Amenities`
- `branch.Name`
- `branch.Address`
- `SpaceCode`
- customer name
- review comment
- booking status
- URL ảnh

Một hàm `escapeHtml()` trong `customer-main.js` đang thay:

```js
.replace(/</g, '<')
.replace(/>/g, '>')
.replace(/"/g, '"')
```

tức là không escape.

Ngoài ra dữ liệu user còn được đặt trong inline JavaScript:

```html
onclick="openModalSafe('${space.Name}', ...)"
```

Đây là context nguy hiểm hơn HTML text.

## Yêu cầu sửa

### Nguyên tắc

1. Không đưa dữ liệu user vào inline event handler.
2. Không đưa object JSON vào chuỗi `onclick`.
3. Không dùng `innerHTML` cho dữ liệu user.
4. Dùng:
   - `document.createElement`
   - `textContent`
   - `setAttribute` có validation
   - `dataset`
   - `addEventListener`
5. Với HTML cố định, có thể dùng template nhưng mọi dữ liệu động phải được gắn bằng DOM API.
6. EJS dùng `<%= value %>` thay cho `<%- value %>` với dữ liệu user.
7. URL ảnh phải validate:
   - protocol `https:`
   - host Cloudinary hoặc domain allowlist
   - fallback nếu URL invalid.
8. Không dùng CSP như lớp phòng thủ duy nhất.

### Viết helper production dùng chung

Ví dụ:

```text
public/js/dom.js
```

Có thể cung cấp:

```js
function createTextElement(tag, className, text) { ... }
function safeImageUrl(value) { ... }
function clearElement(element) { ... }
```

Nhưng test phải import hoặc chạy chính helper production đó.

### Các khu vực phải sửa

Tối thiểu:

```text
public/js/customer-main.js
public/js/customer-history.js
public/js/host-spaces.js
public/js/host-dashboard.js
public/js/admin-main.js
public/js/main.js
```

### Payload test

Kiểm tra:

```html
<img src=x onerror=alert(1)>
```

```html
</button><script>globalThis.__xss = true</script>
```

```text
');alert(document.domain);//
```

Không payload nào được thực thi.

## Không chấp nhận test giả

Không được làm:

```js
function escapeHtmlFn(...) { ... }
expect(escapeHtmlFn(payload))...
```

nếu hàm đó chỉ tồn tại trong test.

Test phải:

- import helper production, hoặc
- render component production bằng JSDOM, hoặc
- chạy integration/browser test trên trang thật.

## Test bắt buộc

- Tên phòng malicious hiển thị như text.
- Description malicious không chạy.
- Amenities malicious không chạy.
- Branch name malicious không chạy.
- Customer name malicious không chạy.
- Inline `onclick` không chứa dữ liệu user.
- `globalThis.__xss` vẫn undefined/false.

---

# 10. P0 — Sửa host dashboard IDOR theo branchId

## Vấn đề

Dashboard nhận:

```text
GET /api/hosts/dashboard-stats?branchId=<id>
```

Khi có branchId, code tìm spaces chỉ bằng `BranchID`, không xác minh branch thuộc host hiện tại.

Host A có thể nhập branch ID Host B.

## Yêu cầu sửa

Nếu `branchId !== 'all'`:

```js
const branch = await Branch.findOne({
  _id: branchId,
  HostID: hostId
}).select('_id');

if (!branch) {
  throw new NotFoundError('Không tìm thấy chi nhánh.');
}
```

Sau đó:

```js
const currentSpaces = await Space.find({
  BranchID: branch._id,
  HostID: hostId
});
```

Tất cả booking query phải có:

```js
HostID: hostId
```

hoặc được giới hạn bằng space IDs đã xác minh ownership.

Không dùng fallback lowercase field sau khi migration đã chuẩn hóa.

Sửa cả:

- recent bookings
- chart
- revenue
- floor plan
- occupied count

## Test bắt buộc

- Host A xem `all` chỉ thấy dữ liệu A.
- Host A xem branch A thành công.
- Host A truyền branch B trả 404 hoặc 403.
- Response không chứa SpaceCode, booking, customer hoặc revenue của B.

---

# 11. P0 — Sửa thuật toán booking slot overlap

## Vấn đề

Thuật toán hiện làm tròn start time lên slot kế tiếp.

Ví dụ slot 30 phút:

```text
Booking A: 10:00–10:20 => slot 10:00
Booking B: 10:05–10:35 => slot 10:30
```

Hai booking giao nhau nhưng không đụng unique slot.

## Phương án A — Bắt buộc biên slot

Đây là phương án đơn giản và an toàn nếu UI chỉ cho slot 30 phút.

Validate:

```js
start minute % BOOKING_SLOT_MINUTES === 0
end minute % BOOKING_SLOT_MINUTES === 0
```

Tất cả booking phải bắt đầu/kết thúc đúng slot boundary.

Sau đó build từ start:

```js
let cursor = new Date(start);

while (cursor < end) {
  slots.push(new Date(cursor));
  cursor = new Date(cursor.getTime() + step);
}
```

## Phương án B — Lock mọi slot giao nhau

Nếu cho booking phút lẻ:

```js
let cursor = new Date(
  Math.floor(start.getTime() / step) * step
);

while (cursor < end) {
  slots.push(new Date(cursor));
  cursor = new Date(cursor.getTime() + step);
}
```

Phải đảm bảo mọi khoảng giao nhau tạo ít nhất một slot trùng.

## Yêu cầu thêm

- Unique index `{ SpaceID, SlotStart }` phải tồn tại trước khi nhận traffic.
- Chạy `Model.init()` hoặc migration index lúc deploy.
- Không silently fallback transaction rồi bỏ dữ liệu dang dở.
- Nếu fallback non-transaction, rollback booking và slot phải được kiểm tra cẩn thận.
- Duplicate key trả 409.
- Hủy booking giải phóng slot.
- Không giải phóng slot của booking khác.

## Test bắt buộc

```text
A: 10:00–10:20
B: 10:05–10:35
=> chỉ một thành công
```

```text
A: 10:10–10:40
B: 10:20–10:30
=> chỉ một thành công
```

```text
A: 10:00–10:30
B: 10:30–11:00
=> cả hai thành công
```

```text
A bị cancel
B đặt lại đúng slot
=> B thành công
```

Test concurrency bằng `Promise.allSettled`, không test tuần tự.

---

# 12. P0 — Giới hạn thời lượng booking và số slot

## Vấn đề

Client có thể gửi end time rất xa, khiến server tạo hàng nghìn/hàng trăm nghìn slot.

## Yêu cầu sửa

Thêm env:

```env
MAX_BOOKING_HOURS=24
MAX_BOOKING_DAYS_AHEAD=180
```

Validate:

```js
const durationMs = end - start;
const maxDurationMs = env.MAX_BOOKING_HOURS * 60 * 60 * 1000;

if (durationMs <= 0 || durationMs > maxDurationMs) {
  throw new ValidationError('Thời lượng đặt chỗ không hợp lệ.');
}
```

Giới hạn số slot:

```js
const maxSlots = Math.ceil(
  env.MAX_BOOKING_HOURS * 60 / env.BOOKING_SLOT_MINUTES
);

if (slotStarts.length > maxSlots) {
  throw new ValidationError('Số lượng slot vượt giới hạn.');
}
```

Validate ngày đặt không vượt quá `MAX_BOOKING_DAYS_AHEAD`.

Validate branch opening/closing time nếu schema có.

## Test bắt buộc

- Booking 10 năm bị từ chối trước khi tạo slots.
- Booking vượt 24 giờ bị từ chối.
- Booking trong giới hạn thành công.
- Không insert bất kỳ Booking/BookingSlot nào khi validation fail.

---

# 13. P1 — Thêm API verify và reject payment

## Vấn đề

`paymentService.verifyPayment()` đã có nhưng không có API host gọi tới.

Payment phần còn lại có thể pending mãi.

## Yêu cầu sửa

Thêm route API host:

```text
PUT /api/hosts/payments/:paymentId/verify
PUT /api/hosts/payments/:paymentId/reject
```

Controller/service:

```js
verifyPayment(hostId, paymentId)
rejectPayment(hostId, paymentId, reason)
```

Ownership bắt buộc:

```js
{
  _id: paymentId,
  HostID: hostId
}
```

Transition:

```text
pending -> successful
pending -> failed
```

Không cho:

```text
successful -> successful
successful -> failed
refunded -> successful
```

Verify phải atomic và chống race:

```js
findOneAndUpdate({
  _id: paymentId,
  HostID: hostId,
  Status: 'pending'
}, {
  $set: {
    Status: 'successful',
    PaidAt: now,
    VerifiedAt: now,
    VerifiedBy: hostId
  }
})
```

Trước khi success phải đảm bảo tổng payment successful không vượt TotalAmount.

Cân nhắc transaction hoặc booking-level lock để hai payment verify đồng thời không vượt tổng.

Reject:

```js
Status = 'failed'
FailureReason = validated reason
VerifiedAt = now
VerifiedBy = hostId
```

Frontend host payments phải có nút xác minh/từ chối dùng CSRF.

## Test bắt buộc

- Host owner verify thành công.
- Host khác không verify được.
- Verify lại payment successful bị từ chối.
- Reject pending thành công.
- Reject payment host khác bị từ chối.
- Hai verify concurrent không làm paid amount vượt TotalAmount.

---

# 14. P1 — Bắt buộc chống duplicate payment

## Vấn đề

Idempotency key đang optional.

Frontend không gửi `Idempotency-Key`.

Check pending rồi create không atomic.

## Yêu cầu sửa

### Frontend

Mỗi hành động thanh toán tạo UUID:

```js
const key = crypto.randomUUID();
```

Gửi:

```http
Idempotency-Key: <uuid>
```

Giữ cùng key khi retry cùng một submission.

### Backend

Validate key:

- required cho payment create.
- UUID hoặc chuỗi đủ entropy.
- giới hạn chiều dài.
- không nhận từ body nếu muốn chuẩn hóa; ưu tiên header.

### Database

Duy trì unique idempotency index.

Thêm chống một pending payment cùng stage:

Ví dụ partial unique index:

```js
paymentSchema.index(
  {
    BookingID: 1,
    CustomerID: 1,
    PaymentType: 1,
    Status: 1
  },
  {
    unique: true,
    partialFilterExpression: {
      Status: 'pending'
    }
  }
);
```

Xem xét tương thích MongoDB/Mongoose thực tế.

Có thể dùng atomic upsert.

## Test bắt buộc

- Cùng idempotency key trả cùng payment.
- Hai request concurrent cùng key chỉ tạo một document.
- Hai request concurrent khác key nhưng cùng pending stage vẫn chỉ một pending.
- Retry sau network error trả document cũ.
- Payment failed có thể submit lại hợp lệ bằng key mới.
- Không thể tạo payment vượt tổng.

---

# 15. P1 — Enforce host verification

## Vấn đề

Host mới đăng ký:

```text
User.Status = active
HostProfile.IsVerified = false
```

Middleware host chỉ kiểm tra role/status.

Host chưa được duyệt vẫn vào được dashboard/API.

## Yêu cầu sửa

Chọn một mô hình rõ ràng.

## Phương án ưu tiên

User host mới:

```text
Status = inactive
```

Admin verify:

```text
HostProfile.IsVerified = true
User.Status = active
tokenVersion += 1
```

Hoặc giữ status active nhưng middleware host bắt buộc `IsVerified === true`.

Dù chọn cách nào:

- Login response cho host chưa duyệt phải rõ ràng.
- Không cho vào `/host/*`.
- Không cho gọi `/api/hosts/*`.
- Admin verify phải atomic hoặc transaction.
- Unverify/revoke phải làm token cũ mất hiệu lực.

## Test bắt buộc

- Host chưa verify không vào API host.
- Host chưa verify không vào page host.
- Admin verify xong host đăng nhập/hoạt động được.
- Token phát trước lúc revoke không còn hiệu lực.

---

# 16. P1 — Sửa revenue dashboard/report

## Vấn đề

Dashboard/report hiện dùng:

```text
Booking.TotalAmount
Booking.DepositAmount
```

để đại diện doanh thu thực nhận.

Điều này sai vì payment pending/failed/refunded không phải tiền đã nhận.

## Yêu cầu sửa

Định nghĩa:

```text
GMV:
  Tổng TotalAmount của booking hợp lệ theo chính sách nghiệp vụ.

ActualRevenue:
  Tổng PaymentHistory.Amount với Status = successful.

PendingAmount:
  Tổng PaymentHistory.Amount với Status = pending.

RefundedAmount:
  Tổng PaymentHistory.Amount với Status = refunded.

OutstandingAmount:
  Tổng max(Booking.TotalAmount - successfulPaid, 0).
```

Dashboard:

- `revenue` = ActualRevenue.
- `paidAmount` = ActualRevenue hoặc đổi tên field rõ nghĩa.
- `pendingAmount` = payment pending.
- Không hiển thị DepositAmount như đã thu.

Report:

- Tính theo payment successful.
- Revenue per space từ payment + booking join.
- Daily revenue theo `PaidAt`, không phải booking `createdAt`.
- Refunded amount được tách riêng.
- Cancelled booking không được coi là doanh thu.
- Export Excel ghi rõ GMV và actual revenue.

Tất cả query phải host-scoped.

## Test bắt buộc

Tạo booking 100.000:

```text
payment pending 30.000
=> actual revenue 0
=> pending 30.000
```

Sau verify:

```text
=> actual revenue 30.000
=> pending 0
=> outstanding 70.000
```

Sau full payment:

```text
=> actual revenue 100.000
=> outstanding 0
```

Refund:

```text
=> actual revenue/net revenue tính đúng theo định nghĩa đã chọn
=> refunded amount hiển thị riêng
```

---

# 17. P1 — Email reset production phải gửi thật

## Vấn đề

`emailService` chỉ lưu email vào outbox RAM.

Production vẫn trả thành công dù không có provider.

## Yêu cầu sửa

Tạo adapter email rõ ràng.

Ví dụ hỗ trợ một trong:

- Resend
- SendGrid
- AWS SES
- SMTP qua Nodemailer

Biến môi trường:

```env
EMAIL_PROVIDER=
EMAIL_FROM=
RESEND_API_KEY=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

Production:

- Thiếu config cần fail-fast hoặc endpoint trả lỗi vận hành.
- Không trả thông báo “đã gửi” nếu provider thất bại.
- Không log OTP.
- Không lưu OTP plaintext ngoài payload gửi tạm thời.
- Không đưa dev outbox vào production memory.

Test:

- Mock provider.
- Provider được gọi với đúng email.
- Provider throw => xử lý đúng.
- Không log OTP.
- Dev/test outbox chỉ hoạt động trong test/development.

Lưu ý chống email enumeration:

- Response public vẫn có thể generic.
- Internal log phải ghi delivery failure mà không lộ OTP.

---

# 18. P1 — Sửa CSP và dependency frontend

## Vấn đề

Layout tải Chart.js từ `cdnjs.cloudflare.com` nhưng CSP không allow domain đó.

## Yêu cầu sửa

Ưu tiên một trong:

1. Dùng package/local static asset.
2. Dùng CDN đã có trong allowlist.
3. Thêm domain chính xác vào CSP.

Tốt nhất:

- Cài Chart.js package.
- Serve bundle local hoặc dùng jsDelivr với pinned version.
- Thêm SRI nếu dùng CDN.
- Không dùng wildcard.

CSP:

- Dần loại bỏ `'unsafe-inline'`.
- Chuyển inline script/event handler sang external JS + addEventListener.
- Có thể dùng nonce nếu cần script động.
- Không nới CSP chỉ để “cho chạy”.

## Test bắt buộc

- Header CSP có source cần thiết.
- Chart.js load được.
- Không có console CSP violation cho assets cần thiết.
- Không thêm `*`.
- Không thêm `unsafe-eval`.

---

# 19. P1 — CSRF implementation và test thực tế

## Vấn đề

Test suite hiện đặt:

```env
DISABLE_CSRF=1
```

nên không test được CSRF.

## Yêu cầu sửa

Chia test:

### Test business logic

Có thể disable CSRF trong test unit/service riêng.

### Test integration security

Không disable CSRF.

Tạo helper:

1. GET `/api/auth/csrf`.
2. Lấy cookie `csrfToken`.
3. Gửi cookie + `X-CSRF-Token`.

Test:

- POST/PUT/DELETE không token => 403.
- Token header không khớp cookie => 403.
- Token đúng => request đi tiếp.
- Route root alias không tồn tại.
- Login/register/forgot/reset exemptions đúng như thiết kế.
- Logout:
  - Quyết định có CSRF hay không.
  - Khuyến nghị logout dùng CSRF để tránh forced logout.
- Origin khác host => 403.
- Origin hợp lệ => đi tiếp.

Không dùng environment switch để vô hiệu hóa toàn bộ security test.

---

# 20. P1 — Sửa test XSS giả

## Vấn đề

`test/upload-xss.test.js` tự viết helper escape riêng trong test.

Test này không chứng minh production an toàn.

## Yêu cầu sửa

Xóa test giả.

Tách DOM renderer/helper production thành module có thể test.

Một trong các cách:

### Cách A — Module CommonJS/UMD

```text
public/js/domSafe.js
```

Export khi Node:

```js
if (typeof module !== 'undefined') {
  module.exports = {...};
}
```

Gắn vào window khi browser.

### Cách B — JSDOM

Cài `jest-environment-jsdom` hoặc `jsdom`.

Load script production và chạy renderer.

### Cách C — Browser integration

Playwright/Puppeteer nếu phù hợp.

Test phải chèn dữ liệu malicious vào renderer thật và xác minh:

- Không có `<script>`.
- Không có element có `onerror`.
- Không có inline `onclick` chứa payload.
- `textContent` đúng.
- Payload không chạy.

---

# 21. P1 — Sửa transaction fallback

## Vấn đề tiềm ẩn

`withOptionalTransaction()` có thể:

1. Chạy work trong transaction.
2. Transaction fail vì standalone MongoDB.
3. Chạy lại toàn bộ work không transaction.

Việc chạy lại có thể tạo side effect hai lần nếu lỗi xuất hiện sau một phần thao tác hoặc là lỗi không thật sự do transaction support.

## Yêu cầu sửa

Không tự động retry toàn bộ callback mù quáng.

Chọn:

### Production

- Yêu cầu MongoDB replica set/Atlas.
- Transaction failure do deployment config phải fail rõ ràng.
- Không fallback silently.

### Development standalone

- Có config rõ:
  ```env
  ENABLE_TRANSACTIONS=false
  ```
- Chọn path trước khi bắt đầu work.
- Không chạy callback hai lần trong cùng request.

Ví dụ:

```js
if (!env.ENABLE_TRANSACTIONS) {
  return work(null);
}

return runInTransaction(work);
```

Không detect bằng string `err.message.includes('Transaction')` rồi rerun.

## Test bắt buộc

- Callback chỉ chạy một lần.
- Transaction error không tạo duplicate booking/payment.
- Non-transaction path rollback sạch khi slot insert fail.
- Audit log không ghi hai lần.

---

# 22. P2 — Chuẩn hóa field và query cũ

Loại dần các fallback:

```text
HostID / hostID
SpaceID / spaceID
BranchID / branchID
FullName / fullName
Status / status
SpaceCode / spaceCode
```

Viết migration script:

```text
scripts/migrateCanonicalFields.js
```

Yêu cầu:

- Dry-run.
- Log số document cần sửa.
- Copy field lowercase sang canonical nếu canonical thiếu.
- Không overwrite canonical đã có.
- Xóa lowercase sau khi xác nhận.
- Idempotent.
- README hướng dẫn backup trước migration.

Sau migration, code production chỉ dùng canonical fields.

---

# 23. P2 — Pagination còn thiếu

Sửa list lớn:

- Admin users.
- Pending hosts.
- Customer payment history.
- Branch reviews.
- Host reports nếu dữ liệu lớn.
- Spaces filter list.

Không dùng:

```js
User.find()
Space.find({})
```

trên route thông thường.

API trả:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5
  }
}
```

Limit max hợp lý.

---

# 24. P2 — Validation tập trung

Dự án đã cài Zod nhưng phải kiểm tra có sử dụng thực tế hay chưa.

Tạo schema:

```text
validators/authSchemas.js
validators/bookingSchemas.js
validators/paymentSchemas.js
validators/hostSchemas.js
validators/commonSchemas.js
```

Validate:

- ObjectId.
- email.
- password.
- fullName length.
- phone.
- bank fields.
- booking dates.
- branchId.
- roomType.
- paymentType.
- idempotency key.
- rejection reason.
- pagination.
- status filter.

Tạo middleware dùng lại.

Không để mỗi controller tự viết validation khác nhau.

---

# 25. GitHub Actions bắt buộc

Tạo:

```text
.github/workflows/ci.yml
```

Chạy trên:

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

Steps:

```text
checkout
setup-node
npm ci
npm run lint
npm test
npm audit --audit-level=high
```

Có cache npm.

Không dùng `continue-on-error` cho lint/test.

Có thể tách audit nếu dependency hiện tại có issue chưa xử lý, nhưng phải báo rõ.

Commit hiện chưa có bằng chứng CI status; bổ sung workflow.

---

# 26. ESLint

Hiện script có thể cho tối đa 100 warnings:

```json
"lint": "eslint . --max-warnings=100"
```

Sửa dần về:

```json
"lint": "eslint . --max-warnings=0"
```

Trước khi bật 0:

- Sửa unused variables.
- Sửa undefined globals.
- Không thêm global giả để che lỗi thực tế như `token`.
- Browser globals chỉ khai báo đúng file.

`no-undef` phải bắt được biến `token` không tồn tại.

---

# 27. Test suite hoàn chỉnh

Tối thiểu phải có các nhóm sau.

## 27.1 Routing và CSRF

- Customer API chỉ tồn tại dưới `/api/customers`.
- Root aliases trả 404.
- Invalid CSRF trả 403.
- Valid CSRF đi tiếp.
- Guest public page không redirect.

## 27.2 Auth

- HttpOnly cookie.
- Logout clear cookie.
- Token version.
- Banned user.
- Unverified host.
- Reset password.
- Email provider mock.

## 27.3 Customer authorization

- Profile self-only.
- Booking self-only.
- Payment self-only.
- Review self-only.

## 27.4 Host authorization

- Booking ownership.
- Branch ownership.
- Space ownership.
- Image ownership.
- Dashboard branch ownership.
- Payment ownership.
- Verify/reject ownership.

## 27.5 Booking

- Past rejected.
- End <= start rejected.
- Duration too long rejected.
- Days ahead too far rejected.
- Inactive space rejected.
- Exact overlap.
- Partial overlap.
- Nested overlap.
- Adjacent non-overlap.
- Cancel releases slot.
- Concurrent requests only one succeeds.
- Job only completes expired in-use bookings.

## 27.6 Payment

- Pending not counted.
- Failed not counted.
- Refunded not counted.
- Successful counted.
- Required idempotency key.
- Concurrent duplicate blocked.
- Pending stage duplicate blocked.
- Verify atomic.
- Reject atomic.
- Overpayment blocked.
- Dashboard revenue correct.

## 27.7 XSS

- Production renderer tested.
- Name/comment/description/amenities safe.
- No inline event handler from user data.
- CSP works.

## 27.8 Upload

- File too large.
- PDF avatar rejected.
- PDF verification accepted.
- MIME invalid rejected.
- Orphan Cloudinary cleanup where possible.
- Ownership before delete.

---

# 28. Manual smoke test

Sau automated test, thực hiện manual smoke test hoặc script tương đương:

## Guest

1. Mở `/`.
2. Mở `/search`.
3. Mở `/detail?branchId=...`.
4. Check availability.
5. Không bị redirect login.

## Customer

1. Login.
2. Create booking.
3. Submit deposit payment.
4. Xem history.
5. Logout.
6. Private API sau logout trả 401.

## Host

1. Login host verified.
2. Dashboard.
3. Filter branch.
4. Xem booking.
5. Verify payment.
6. Check-in.
7. Không xem branch host khác.

## Admin

1. Verify host.
2. Ban user.
3. Token user bị ban mất hiệu lực.
4. Xem audit log pagination.

---

# 29. Definition of Done

Chỉ kết thúc khi tất cả mục sau đạt:

- [ ] Customer page/API routers đã tách.
- [ ] Không còn API customer ngoài `/api/customers`.
- [ ] Không bypass CSRF bằng root route.
- [ ] Guest không bị redirect login.
- [ ] Check availability hoạt động cho guest.
- [ ] Không còn đọc JWT từ localStorage.
- [ ] Không còn biến `token` legacy.
- [ ] Không còn `Bearer ${token}` frontend.
- [ ] Không còn dữ liệu user trong inline event handler.
- [ ] XSS test chạy code production.
- [ ] Host dashboard branch ownership đã đóng.
- [ ] Booking partial overlap bị chặn.
- [ ] Adjacent booking vẫn hợp lệ.
- [ ] Booking duration bị giới hạn.
- [ ] Số slot bị giới hạn.
- [ ] Payment verify API tồn tại.
- [ ] Payment reject API tồn tại.
- [ ] Verify/reject host-scoped.
- [ ] Idempotency key bắt buộc.
- [ ] Concurrent duplicate payment bị chặn.
- [ ] Host chưa verify bị chặn.
- [ ] Revenue dùng payment successful.
- [ ] Email provider production hoạt động hoặc fail rõ.
- [ ] CSP không chặn Chart.js.
- [ ] Không tự rerun transaction callback.
- [ ] CSRF integration tests không disable middleware.
- [ ] GitHub Actions CI tồn tại.
- [ ] ESLint không bỏ qua undefined variable.
- [ ] `npm run lint` pass.
- [ ] `npm test` pass.
- [ ] `npm audit` đã chạy và kết quả được báo thật.
- [ ] README và `.env.example` cập nhật.
- [ ] Không để TODO giả.
- [ ] Không tuyên bố pass nếu chưa chạy.

---

# 30. Kết quả cuối cùng Grok phải trả

Sau khi sửa xong, báo cáo đúng cấu trúc:

## A. Commit/branch

- Branch đã sửa.
- Commit SHA mới.
- Commit message.

## B. Blocker đã sửa

Cho từng lỗi:

- Root cause.
- File sửa.
- Cách sửa.
- Test chứng minh.

## C. Danh sách file thay đổi

Liệt kê đầy đủ.

## D. Database migration/index

- Index mới.
- Index cũ cần xóa.
- Migration script.
- Lệnh chạy.
- Backup/rollback.

## E. API thay đổi

Liệt kê:

```text
method
path
auth
CSRF
request
response
breaking change
```

## F. Kết quả lệnh

Dán kết quả thật:

```bash
npm ci
npm run lint
npm test
npm audit
```

Không được ghi “passed” nếu không chạy.

## G. Test count

- Test suites.
- Tests passed.
- Tests failed.
- Tests skipped.

## H. Hạn chế còn lại

Nêu cụ thể file và rủi ro.

---

# 31. Tài liệu kỹ thuật tham chiếu

Khi quyết định cách sửa, đối chiếu các nguyên tắc sau:

- Express Production Security Best Practices:
  - Không tin input.
  - Helmet.
  - Cookie `secure` và `httpOnly`.
  - Brute-force protection.
  - Dependency audit.

- OWASP Cross-Site Scripting Prevention:
  - Output encoding đúng context.
  - Ưu tiên safe DOM sinks.
  - Không chỉ dựa vào CSP.
  - Không đưa dữ liệu user vào JavaScript context.

- OWASP CSRF Prevention:
  - Cookie-authenticated state-changing requests cần CSRF protection.
  - Double-submit cookie phải so khớp cookie/header.
  - SameSite là defense-in-depth, không thay toàn bộ CSRF validation.

- MongoDB:
  - Unique index phải phản ánh đúng resource conflict.
  - Transaction dùng cho nghiệp vụ nhiều document.
  - Không rerun callback có side effect một cách mù quáng.

---

# 32. Lệnh bắt đầu

Bắt đầu ngay bằng:

1. Checkout commit hiện tại.
2. Đọc các file được chỉ định.
3. Chạy baseline:
   ```bash
   npm ci
   npm run lint
   npm test
   npm audit
   ```
4. Ghi nhận lỗi baseline.
5. Sửa P0 trước.
6. Viết test regression trước hoặc cùng lúc với fix.
7. Sửa P1/P2.
8. Chạy lại toàn bộ.
9. Commit thay đổi với message rõ ràng.

Không chỉ đưa ra patch mẫu. Hãy sửa trực tiếp toàn repository và hoàn thành Definition of Done.
