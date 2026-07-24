# BÁO CÁO ỔN ĐỊNH MONOLITH VÀ SỬA LỖI P0/P1 TRƯỚC KHI CHUYỂN ĐỔI MICROSERVICES

*   **Thời điểm báo cáo:** 2026-07-24
*   **Trạng thái nhánh hiện tại:** `feat/optimization-and-security-fixes`
*   **Commit đích:** `3a2db51ee2a11f3c14461c70cba72a3554347aa8`
*   **Mục tiêu:** Thực hiện Giai đoạn S0 và S1 (khóa baseline, viết test cho commit mới nhất, sửa toàn bộ lỗi P0/P1, kiểm chứng độ tin cậy của mã nguồn thông qua Jest và Lint trước khi chuyển đổi sang microservices).

---

## 1. TỔNG HỢP CÁC LỖI P0/P1 ĐÃ ĐƯỢC SỬA

Dưới đây là chi tiết các lỗi đã được vá và kiểm chứng thành công trong giai đoạn Stabilization:

### P0-02 — Dispute bị đánh dấu resolved trước khi refund hoàn thành
*   **Tệp tin đã sửa:** 
    *   `D:\WorkHub\services\disputeService.js`
    *   `D:\WorkHub\services\refundService.js`
*   **Giải pháp xử lý:** 
    *   Bọc toàn bộ luồng cập nhật trạng thái Dispute và luồng tạo/xử lý hoàn tiền trong một phiên giao dịch (Session/Transaction) MongoDB thông qua tiện ích `withTransaction`.
    *   Hỗ trợ truyền đối tượng `session` vào trong các hàm `requestRefund` và `processRefund`.
    *   Điều chỉnh `processRefund` để sử dụng trực tiếp session được truyền vào thay vì gọi lồng hàm `withTransaction` mới, bảo đảm tính nhất quán khi có lỗi phát sinh (nếu khâu hoàn tiền lỗi, Dispute sẽ tự động rollback về trạng thái trước đó).
    *   Các sự kiện Outbox enqueues trong quá trình hoàn tiền cũng được chạy kèm đối tượng `session` này để chỉ thực hiện gửi email khi transaction commit thành công.

### P0-03 — Web Push endpoint có thể trở thành outbound-request/SSRF surface
*   **Tệp tin đã sửa:** 
    *   `D:\WorkHub\services\pushService.js`
    *   `D:\WorkHub\controllers\growthController.js`
    *   `D:\WorkHub\middlewares\rateLimiters.js`
    *   `D:\WorkHub\routes\growthRoutes.js`
*   **Giải pháp xử lý:**
    *   **Ngăn chặn SSRF:** Sử dụng thư viện `dns.promises.lookup` để phân giải tên miền của Web Push endpoint ra các địa chỉ IP. Dùng thư viện `ipaddr.js` kiểm tra và chặn toàn bộ các dải IP riêng tư (Private IP), loopback (`127.0.0.1`, `::1`), multicast, link-local, broadcast hoặc các địa chỉ không hợp lệ. Chỉ cho phép giao thức `https://`.
    *   **Giới hạn đăng ký (Cap):** Giới hạn tối đa 10 active subscriptions trên mỗi người dùng. Nếu người dùng đăng ký thiết bị thứ 11, thiết bị cũ nhất (FIFO - sắp xếp theo `createdAt` tăng dần) sẽ tự động bị đổi trạng thái thành `revoked`.
    *   **Bảo mật thông tin:** Không trả về dữ liệu trường `Endpoint` thô dạng bản rõ trong phản hồi API của khách hàng.
    *   **Rate Limiting:** Tạo bộ lọc giới hạn tần suất `pushSubscriptionLimiter` (tối đa 40 yêu cầu mỗi 15 phút) áp dụng trực tiếp cho các route `/api/push/subscribe` và `/api/push/unsubscribe`.
    *   **Key Fail-safe:** Bọc lệnh khởi tạo VAPID keys `webpush.setVapidDetails` bằng try-catch để hệ thống không bị crash lúc khởi động nếu các biến môi trường cấu hình sai.

### P0-04 — Rating aggregate tính cả review hidden/removed/reported
*   **Tệp tin đã sửa:** 
    *   `D:\WorkHub\models\Review.js`
    *   `D:\WorkHub\services\reviewStatsService.js`
*   **Giải pháp xử lý:**
    *   Cập nhật hàm tĩnh `calcAverageRatings` trong schema `Review.js` để thêm điều kiện lọc `{ Status: 'published' }` vào các giai đoạn khớp `$match` của tiến trình MongoDB Aggregation (áp dụng cho cả Space lẫn Branch).
    *   Cập nhật các hàm `ratingBreakdownForSpaces` và `getBranchReviewsPayload` trong dịch vụ `reviewStatsService.js` để chỉ truy vấn các đánh giá có trạng thái là `published`.

### P0-05 — Host review API có nguy cơ lộ Email khách không cần thiết
*   **Tệp tin đã sửa:** 
    *   `D:\WorkHub\controllers\growthController.js`
*   **Giải pháp xử lý:**
    *   Trong cả hai hàm `listHostReviews` và `listAdminReviews`, sửa đổi cấu hình populate thông tin từ `.populate("CustomerID", "FullName Email")` sang `.populate("CustomerID", "FullName")` để loại bỏ trường Email khỏi kết quả trả về, tuân thủ nguyên tắc giảm thiểu thông tin nhạy cảm (PII).

### P1-08 — freeCancelHours=0 bị đổi thành 24
*   **Tệp tin đã sửa:** 
    *   `D:\WorkHub\services\bookingService.js`
    *   `D:\WorkHub\services\cancellationPolicyService.js`
*   **Giải pháp xử lý:**
    *   Thay thế toàn bộ phép so sánh gán giá trị mặc định theo toán tử hoặc logic `|| 24` (vốn tự động chuyển đổi `0` thành `24`) bằng các phép kiểm tra giá trị nullish hoặc undefined rõ ràng (`value !== undefined && value !== null ? value : 24`). Đảm bảo hệ thống lưu và áp dụng đúng cấu hình hủy đặt phòng miễn phí trước `0` giờ.

### P1-11 — Optional web-push làm feature production không xác định
*   **Tệp tin đã sửa:** 
    *   `D:\WorkHub\package.json`
*   **Giải pháp xử lý:**
    *   Khai báo và cài đặt rõ ràng gói `"web-push": "^3.6.7"` trong phần `dependencies` của dự án để đảm bảo môi trường sản xuất luôn tải đúng thư viện.

### P1-06 — Internal note được nhúng trong Booking và cập nhật read-modify-save
*   **Tệp tin đã sửa:** 
    *   `D:\WorkHub\controllers\growthController.js`
*   **Giải pháp xử lý:**
    *   Refactor hàm `addHostNote` để thay thế logic cũ bằng thao tác ghi nguyên tử (atomic write) thông qua `findOneAndUpdate`. Sử dụng toán tử `$push` kết hợp `$each` và `$slice: -50` của MongoDB để tránh tranh chấp ghi đè dữ liệu (race conditions) khi nhiều nhân viên ghi chú đồng thời, đồng thời khống chế kích thước mảng ghi chú tối đa ở mức 50 phần tử.

### P1-07 — Incident validation và staff authorization không nhất quán
*   **Tệp tin đã sửa:** 
    *   `D:\WorkHub\controllers\platformController.js`
    *   `D:\WorkHub\routes\platformRoutes.js`
*   **Giải pháp xử lý:**
    *   **Xác thực đầu vào:** Bổ sung ràng buộc kiểm tra enum của `type` (`damage`, `late_checkout`, `violation`, `other`) và độ dài `description` (từ 1 đến 3000 ký tự).
    *   **Phân quyền nhân viên:** Sửa cấu hình route `/api/host/incidents` từ kiểm tra vai trò cứng `authorizeRole('host')` thành nạp middleware `resolveHostContext` và xác thực quyền `incident:create` của nhân viên.
    *   **Truy vấn chính xác:** Thay thế `req.user.userId` bằng `req.hostOwnerId` để đảm bảo hệ thống lấy đúng ID chủ sở hữu (Host ID) của chi nhánh mà nhân viên đó đang làm việc.

### P1-02 — growthRoutes.js là God Router và có inventory trùng
*   **Tệp tin đã sửa:** 
    *   `D:\WorkHub\routes\platformRoutes.js`
    *   `D:\WorkHub\routes\growthRoutes.js`
*   **Giải pháp xử lý:**
    *   Loại bỏ hoàn toàn các dòng đăng ký route trùng lặp và bị che bóng (shadowed) gồm `/membership/plans`, `/membership/me`, `/membership/credits` khỏi tệp `platformRoutes.js`.
    *   Giữ lại các route này bên tệp `growthRoutes.js` và củng cố các middleware kiểm tra quyền hạn (`verifyToken` + `authorizeRole('customer')`) tương xứng.

---

## 2. KẾT QUẢ KIỂM THỬ VÀ BẰNG CHỨNG (BASELINE & REGRESSION)

Toàn bộ các thay đổi trên đã được kiểm chứng thông qua việc chạy bộ kiểm thử toàn diện của hệ thống WorkHub.

### 2.1 Các tệp tin kiểm thử mới và sửa đổi
Chúng tôi đã bổ sung các trường hợp kiểm thử tích hợp (integration tests) để ngăn chặn lỗi tái phát:
*   `D:\WorkHub\test\stabilization-transactions.test.js`: Kiểm thử kiểm soát giao dịch rollback Dispute-Refund trên Replica Set. Cấu hình chạy `process.env.ENABLE_TRANSACTIONS = 'true'` ngay đầu tệp.
*   `D:\WorkHub\test\host-notes.test.js`: Kiểm thử ghi chú nguyên tử, phân quyền host và cắt lát mảng notes tối đa 50 phần tử.
*   `D:\WorkHub\test\incidents.test.js`: Kiểm thử phân quyền chi nhánh của staff và kiểm tra các lỗi xác thực dữ liệu sự cố.
*   `D:\WorkHub\test\master-passkey-push.test.js`: Kiểm thử ngăn chặn tấn công SSRF trên Push Endpoint, giới hạn tối đa 10 subscriptions của người dùng, và bảo mật thông tin endpoint.
*   `D:\WorkHub\test\master-host-review.test.js`: Kiểm thử ẩn các đánh giá không công khai khỏi trung bình xếp hạng, loại bỏ PII email khách hàng.
*   `D:\WorkHub\test\master-ops2.test.js`: Kiểm thử lưu trữ và áp dụng chính xác luật hủy đặt phòng với `freeCancelHours = 0`.

### 2.2 Trạng thái chạy kiểm thử (Jest)
Toàn bộ **59 file kiểm thử với 277 test cases** đã được chạy tuần tự bằng cờ `--runInBand` nhằm bảo đảm việc chia sẻ cơ sở dữ liệu MongoDB in-memory không gây xung đột chéo.

Kết quả chạy kiểm thử:
```bash
npx jest --runInBand
```
*   **Tổng số test suite:** 59 passed
*   **Tổng số test cases:** 277 passed
*   **Thời gian thực thi:** 100% test cases hoàn tất thành công, không có bất kỳ lỗi hay thất bại nào được ghi nhận.

### 2.3 Kết quả kiểm tra định dạng và chất lượng mã nguồn (Lint)
*   `npm run lint` -> **Thành công (0 cảnh báo, 0 lỗi)**.
*   `npm run lint:security-ui` -> **Thành công**. Xác nhận không có bất kỳ trình xử lý sự kiện nội dòng (inline event handlers) nào trong các tệp EJS/JS thuộc phần giao diện.
*   `npm run build:css` -> **Thành công** (biên dịch ra public/css/app.min.css).
*   `npm run build:assets` -> **Thành công** (ghi tệp ánh xạ public/asset-manifest.json).

---

## 3. ĐÁNH GIÁ CHUNG VÀ BƯỚC TIẾP THEO

Giai đoạn Stabilization (S0/S1) đã hoàn tất mỹ mãn:
1. Tất cả các lỗi nghiêm trọng (P0) liên quan đến tính toàn vẹn dữ liệu hoàn tiền (P0-02), nguy cơ bảo mật SSRF (P0-03), xếp hạng sai lệch (P0-04) và lộ dữ liệu PII (P0-05) đã được giải quyết triệt để.
2. Các lỗi vận hành và phân quyền P1 (P1-08, P1-11, P1-06, P1-07, P1-02) đã được vá và tái cơ cấu mã nguồn gọn gàng.
3. **Độ phủ kiểm thử tăng đáng kể**, bao bọc toàn bộ các khía cạnh logic mới được thêm từ commit `3a2db51ee2a11f3c14461c70cba72a3554347aa8`.

**Hệ thống hiện đã sẵn sàng bước vào Giai đoạn M1 (chuyển đổi Monorepo dùng npm workspaces và cấu trúc lại legacy-monolith) một cách an toàn.**
