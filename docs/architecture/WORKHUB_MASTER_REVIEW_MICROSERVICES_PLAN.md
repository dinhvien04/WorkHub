# WORKHUB — REVIEW COMMIT MỚI NHẤT, KẾ HOẠCH SỬA LỖI VÀ ĐẶC TẢ CHUYỂN ĐỔI MICROservices

> **Tài liệu thực thi dành cho Claude Code / kỹ sư phát triển**
>
> Repo: `dinhvien04/WorkHub`  
> Commit được review: `3a2db51ee2a11f3c14461c70cba72a3554347aa8`  
> Commit message: `feat: host reviews, reception notes/incidents, push, and admin review UI`  
> Thời điểm lập tài liệu: 2026-07-24  
> Trạng thái mục tiêu: **Microservices thật**, triển khai theo **Strangler Fig**, không big-bang rewrite.

---

# 0. CÁCH DÙNG TÀI LIỆU NÀY VỚI CLAUDE CODE

Đặt file này tại thư mục gốc dự án, ví dụ:

```text
D:\WorkHub\WORKHUB_MASTER_REVIEW_MICROSERVICES_PLAN.md
```

Sau đó mở Claude Code tại thư mục dự án và dùng lệnh:

```text
Đọc toàn bộ WORKHUB_MASTER_REVIEW_MICROSERVICES_PLAN.md.

Xem đây là đặc tả kỹ thuật bắt buộc. Trước tiên chỉ thực hiện Giai đoạn S0 và S1:
- khóa baseline;
- viết test cho commit mới nhất;
- sửa lỗi P0/P1;
- không bắt đầu di chuyển microservices cho đến khi baseline xanh.

Không reset, checkout hoặc xóa thay đổi hiện tại.
Không sửa trực tiếp main.
Không push, merge hoặc rewrite Git history.
Không tạo hàng loạt thư mục rỗng.
Sau mỗi nhóm thay đổi phải chạy lint, test liên quan, full test và build.
Cập nhật MICROSERVICES_MIGRATION_REPORT.md với bằng chứng cụ thể.
```

Khi S0/S1 hoàn tất, tiếp tục:

```text
Tiếp tục theo WORKHUB_MASTER_REVIEW_MICROSERVICES_PLAN.md từ Phase M0.
Mỗi phase phải đạt exit criteria trước khi sang phase kế tiếp.
Đích cuối là microservices thật; đường đi phải incremental, testable và rollback được.
```

---

# 1. PHẠM VI REVIEW VÀ NGUỒN SỰ THẬT

Tài liệu này dựa trên:

1. Commit mới nhất quan sát được trên repository:
   `3a2db51ee2a11f3c14461c70cba72a3554347aa8`.
2. Diff giữa commit trên và commit cha:
   `47b74fafbf76f32b038473cbf671582c561cc93b`.
3. Các file bị thay đổi trong commit.
4. Các code path backend liên quan trực tiếp:
   - `controllers/growthController.js`
   - `controllers/platformController.js`
   - `services/disputeService.js`
   - `services/refundService.js`
   - `services/pushService.js`
   - `models/Review.js`
   - `models/Incident.js`
   - `models/PushSubscription.js`
   - `routes/growthRoutes.js`
   - `routes/platformRoutes.js`
   - `app.js`
5. Các script kiểm tra hiện có trong `package.json`.
6. Hướng dẫn chính thức về:
   - Strangler Fig;
   - API Gateway;
   - database ownership;
   - Saga;
   - Transactional Outbox;
   - RabbitMQ acknowledgements/publisher confirms;
   - OpenTelemetry;
   - OWASP API Security;
   - Web Push.

Không được hiểu tài liệu này là chứng nhận rằng ứng dụng đã “an toàn tuyệt đối” hoặc “enterprise-ready”. Đây là code review và kế hoạch kỹ thuật có ưu tiên.

---

# 2. SNAPSHOT COMMIT MỚI NHẤT

## 2.1 Thống kê

Commit mới nhất thay đổi:

```text
17 files
701 additions
11 deletions
712 total changed lines
0 test files changed
0 CI status checks được ghi nhận trên commit
0 workflow run được ghi nhận cho commit
```

Đây là một commit chức năng tương đối lớn nhưng không bổ sung test. Điều này là rủi ro quan trọng nhất cần xử lý trước khi tiếp tục mở rộng kiến trúc.

## 2.2 Danh sách file thay đổi

```text
app.js
controllers/growthController.js
public/js/admin-disputes.js
public/js/admin-health.js
public/js/host-ops.js
public/js/host-reception.js
public/js/host-reviews.js                 [new]
public/js/main.js
public/js/membership.js
public/js/security.js
routes/growthRoutes.js
views/admin/health.ejs
views/customer/membership.ejs
views/customer/security.ejs
views/host/ops.ejs
views/host/reception.ejs
views/host/reviews.ejs                    [new]
```

## 2.3 Chức năng được thêm hoặc mở rộng

Commit bổ sung hoặc mở rộng các nhóm sau:

- Trang host quản lý và trả lời review.
- API host liệt kê review.
- API admin liệt kê review để moderation.
- UI admin publish/hide/remove review.
- UI admin resolve/reject dispute với số tiền refund.
- UI admin xử lý payout/refund/dead letter.
- Ghi chú nội bộ trên booking tại quầy lễ tân.
- Tạo incident từ màn hình lễ tân.
- Thay đổi buffer/cleanup/free-cancel/instant-book cho space.
- Hiển thị membership credit ledger.
- Bật/tắt Web Push từ trang Security.
- Route page `/host/reviews`.

## 2.4 Điểm tốt trong commit

Các điểm tích cực cần giữ:

- Frontend chủ yếu dùng `textContent` hoặc `DomSafe`, giảm nguy cơ DOM XSS.
- Host review endpoint kiểm tra ownership thông qua space thuộc host.
- Admin review endpoint được bảo vệ bằng `requireAdmin`.
- Push unsubscribe gắn với `UserID + Endpoint`, không revoke subscription của người khác.
- Push sender tự revoke subscription trả về `404/410`.
- Refund service hiện có idempotency key và kiểm tra tổng tiền đã thanh toán.
- UI có empty state cơ bản.
- Reception scan hỗ trợ booking code và QR token.
- Space ops có clamp các giá trị phút/giờ.
- Review report có chống reporter trùng lặp trong một code path.
- Nhiều thao tác tài chính đã đi qua service thay vì cập nhật model trực tiếp từ UI.

Những điểm tốt trên không loại bỏ các vấn đề kiến trúc và consistency ở phần sau.

---

# 3. KẾT LUẬN REVIEW

## 3.1 Kết luận ngắn

Commit mới **tăng tính năng rõ rệt**, nhưng đồng thời làm nghiêm trọng hơn ba vấn đề cốt lõi:

1. **God Controller / God Router / God Admin Page tiếp tục phình to.**
2. **Nhiều endpoint mới chưa có validation, pagination, audit và test tương xứng.**
3. **Ranh giới domain ngày càng mờ**, đặc biệt giữa:
   - catalog;
   - booking;
   - billing;
   - communication;
   - operations;
   - admin UI.

Không nên bắt đầu big-bang microservices ngay trên trạng thái này. Phải ổn định commit mới, khóa contract, viết characterization test rồi mới extract từng bounded context.

## 3.2 Mức độ ưu tiên

| Mức | Ý nghĩa | Yêu cầu |
|---|---|---|
| P0 | Có thể gây sai dữ liệu, sai tiền, lộ dữ liệu hoặc đường tấn công đáng kể | Sửa trước migration |
| P1 | Có thể gây lỗi production, khó scale, khó audit hoặc khó bảo trì | Sửa trong stabilization |
| P2 | Chất lượng, UX, consistency, technical debt | Sửa theo module |
| P3 | Cải tiến dài hạn | Đưa vào backlog |

---

# 4. PHÁT HIỆN P0 — PHẢI SỬA TRƯỚC KHI CHẠY MICROservices

## P0-01 — Commit thêm 701 dòng nhưng không có test

### Hiện trạng

Không có file test nào thay đổi trong commit, trong khi commit thêm:

- review moderation;
- host reply;
- internal notes;
- incidents;
- Web Push;
- membership credit display;
- space policy update;
- financial admin controls.

### Rủi ro

- BOLA/authorization regression.
- Refund sai hoặc xử lý hai lần.
- Host đọc review của host khác.
- Staff vượt branch scope.
- Push subscription của user khác bị thao tác.
- Rating aggregate sai khi review bị hidden/removed.
- `freeCancelHours=0` bị biến đổi.
- UI mới lỗi nhưng CI không phát hiện.
- Không có contract để giữ khi chuyển service.

### Việc phải làm

Tạo tối thiểu:

```text
test/reviews-host-list.test.js
test/reviews-host-reply.test.js
test/reviews-admin-moderation.test.js
test/reviews-rating-aggregation.test.js
test/reception-notes.test.js
test/incidents-authorization.test.js
test/push-subscription.test.js
test/space-ops-policy.test.js
test/dispute-refund-consistency.test.js
test/membership-credit-ledger-contract.test.js
test/latest-commit-ui-dom.test.js
```

### Acceptance criteria

- Host A không đọc/reply review của Host B.
- Admin-only moderation được kiểm chứng.
- Hidden/removed review không được tính vào public rating.
- Note không mất khi hai request chạy đồng thời.
- Incident staff bị giới hạn đúng branch.
- Push endpoint không nhận URL tùy ý.
- Refund dispute lỗi giữa chừng không để dispute “resolved” giả.
- `freeCancelHours=0` lưu đúng bằng `0`.
- CI chạy lint/test/build trên mọi push/PR.

---

## P0-02 — Dispute bị đánh dấu resolved trước khi refund hoàn thành

### Hiện trạng

`disputeService.resolveDispute()`:

1. đặt dispute thành `resolved`;
2. lưu dispute;
3. gọi `requestRefund`;
4. tìm refund mới nhất;
5. gọi `processRefund`.

Nếu bước 3, 4 hoặc 5 lỗi, dispute đã là `resolved` nhưng refund chưa được tạo hoặc chưa hoàn tất.

### Rủi ro

- Admin nhìn thấy dispute đã giải quyết dù tiền chưa hoàn.
- Người dùng không biết cần thao tác lại.
- Retry khó xác định trạng thái.
- Có thể tạo nhiều refund nếu reconciliation không chặt.
- Khi tách Billing Service, lỗi dual-write trở nên nghiêm trọng hơn.

### Sửa tạm trong monolith

Tạo state machine:

```text
open
under_review
resolution_pending
refund_pending
resolved
rejected
resolution_failed
```

Luồng có refund:

```text
open -> resolution_pending
resolution_pending -> refund_pending
refund_pending -> resolved
refund_pending -> resolution_failed
```

Không ghi `resolved` trước khi refund đạt trạng thái phù hợp.

Dùng một trong hai:

- local MongoDB transaction nếu tất cả collection cùng database;
- Transactional Outbox + workflow worker.

### Đích microservices

Dùng Saga:

```text
Admin resolves dispute
  -> Billing command RefundRequested
  -> Billing emits billing.refund-completed.v1
  -> Dispute/Operations consumes event
  -> marks dispute resolved
```

Compensation:

```text
billing.refund-failed.v1
  -> dispute resolution_failed
  -> admin queue receives retry/manual action
```

### Test bắt buộc

- inject lỗi sau khi dispute claim;
- inject lỗi khi requestRefund;
- inject lỗi khi provider refund;
- retry cùng idempotency key;
- hai admin resolve đồng thời;
- refund amount vượt net paid;
- reject không tạo refund.

---

## P0-03 — Web Push endpoint có thể trở thành outbound-request/SSRF surface

### Hiện trạng

Client gửi:

```json
{
  "endpoint": "...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}
```

Server chỉ kiểm tra endpoint có tồn tại, sau đó lưu. Khi gửi push, `web-push` thực hiện outbound request tới endpoint đã lưu.

### Rủi ro

Một client đã đăng nhập có thể gửi endpoint do mình tự dựng thay vì endpoint do browser push service cấp. Nếu không có validation mạng chặt, server có thể bị ép gửi request tới:

- internal service;
- metadata endpoint;
- localhost;
- private IP;
- redirect chain;
- endpoint rất dài hoặc độc hại.

Ngoài ra:

- không có giới hạn số subscription/user;
- keys có thể trống;
- endpoint và auth secret được lưu plaintext;
- endpoint được trả ngược trong response;
- không có rate limit subscribe/unsubscribe;
- không có schema validation.

### Việc phải sửa

1. Dùng Zod schema:
   - endpoint HTTPS;
   - max length;
   - `p256dh` và `auth` bắt buộc;
   - base64url format;
   - user agent max length.
2. Giới hạn subscription/user, ví dụ 10.
3. Không trả endpoint trong DTO; trả `subscriptionId`, `deviceName`, `createdAt`.
4. `Keys.auth`, endpoint và metadata nhạy cảm:
   - `select: false`;
   - encryption at rest nếu có thể;
   - không log.
5. Rate limit:
   - subscribe;
   - unsubscribe;
   - test push.
6. Hạn chế endpoint:
   - allowlist push service hostname được hỗ trợ, hoặc
   - outbound HTTP client có DNS/IP validation, chặn private/link-local/loopback, không follow redirect tùy ý.
7. Thêm timeout.
8. Đưa việc gửi push vào queue/outbox, không gửi đồng bộ trong request.
9. Thêm dependency `web-push` rõ ràng nếu feature được bật; không dùng optional dependency im lặng trong production.
10. VAPID private key chỉ đọc qua central config/secret manager.

### Đích microservices

Toàn bộ PushSubscription và delivery thuộc `communication-service`.

---

## P0-04 — Rating aggregate tính cả review hidden/removed/reported

### Hiện trạng

`Review.calcAverageRatings()` aggregate theo `SpaceID`, nhưng không lọc:

```text
Status = published
```

Vì vậy review đã bị:

- hidden;
- removed;
- reported

vẫn có thể ảnh hưởng rating branch/space.

### Rủi ro

- Moderation UI không thực sự thay đổi rating public.
- Rating hiển thị sai.
- Review spam đã bị gỡ vẫn kéo điểm.
- Dữ liệu public host/listing không đồng nhất.

### Việc phải sửa

Aggregate chỉ tính review public:

```js
{
  $match: {
    SpaceID: { $in: spaceIds },
    Status: "published"
  }
}
```

Và space aggregate tương tự.

### Vấn đề phụ

Mongoose hook hiện gọi tính rating theo kiểu fire-and-forget. Hook không đảm bảo caller chờ aggregate hoàn tất.

Cần:

- await rõ ràng, hoặc
- phát outbox event `catalog.review-moderated.v1`;
- worker cập nhật rating read model;
- có retry/idempotency;
- có reconciliation job.

### Test bắt buộc

- published -> hidden làm rating giảm/đổi;
- hidden -> published cập nhật lại;
- removed không tính;
- report tự chuyển status nhưng public rating xử lý đúng policy;
- concurrent review save;
- worker retry.

---

## P0-05 — Host review API có nguy cơ lộ Email khách không cần thiết

### Hiện trạng

Host list review populate:

```text
CustomerID: FullName Email
```

UI chỉ dùng `FullName`; email không cần thiết cho việc trả lời review.

### Rủi ro

- Excessive data exposure.
- Tăng phạm vi PII cho host.
- Khó tuân thủ data minimization.
- Khi tách Identity Service, Catalog không nên lấy email nếu không có business need.

### Việc phải sửa

Presenter trả:

```json
{
  "reviewId": "...",
  "rating": 5,
  "comment": "...",
  "status": "published",
  "customer": {
    "displayName": "...",
    "avatarUrl": null
  },
  "space": {
    "spaceId": "...",
    "name": "...",
    "code": "..."
  },
  "hostReply": "...",
  "createdAt": "..."
}
```

Không trả:

- customer email;
- raw User document;
- raw Space document;
- internal moderation data không cần thiết.

---

# 5. PHÁT HIỆN P1 — SỬA TRONG STABILIZATION

## P1-01 — `growthController.js` tiếp tục trở thành God Controller

Commit thêm review APIs vào một controller vốn đã chứa:

- payment gateway;
- payouts;
- refunds;
- membership;
- recurring booking;
- fraud;
- partner API;
- sessions;
- i18n;
- RUM;
- iCal;
- dead letters;
- review;
- check-in;
- dashboard;
- SEO;
- export;
- push;
- notes;
- admin operations.

### Yêu cầu

Không thêm chức năng mới vào `growthController.js`.

Tạo compatibility controller nhỏ:

```text
controllers/reviewController.js
controllers/pushController.js
controllers/hostNoteController.js
controllers/spacePolicyController.js
```

Sau đó phase microservices sẽ chuyển chúng sang service tương ứng.

---

## P1-02 — `growthRoutes.js` là God Router và có inventory trùng

Router chứa hàng loạt domain không liên quan.

Ngoài ra repository có route membership ở nhiều router:

```text
platformRoutes:
  /membership/plans
  /membership/me
  /membership/credits

growthRoutes:
  /membership/plans
  /membership/me
  /membership/credits
```

Do thứ tự mount, một nhóm có thể che nhóm còn lại. Đây là:

- API inventory không rõ;
- hành vi phụ thuộc thứ tự;
- khó test;
- nguy cơ sửa endpoint nhưng sửa nhầm implementation không chạy.

### Việc phải làm

Tạo script:

```text
scripts/list-routes.js
scripts/detect-duplicate-routes.js
```

CI phải fail nếu trùng:

```text
METHOD + normalized path
```

Tách route:

```text
routes/reviewRoutes.js
routes/pushRoutes.js
routes/membershipRoutes.js
routes/hostOperationsRoutes.js
routes/adminOperationsRoutes.js
```

Trong microservices, gateway route ownership phải được ghi trong catalog.

---

## P1-03 — Review list không có pagination chuẩn

Hiện chỉ dùng:

```text
limit = min(query.limit || 50, 100)
```

Thiếu:

- page/cursor;
- total;
- next cursor;
- positive integer validation;
- stable tie-breaker;
- index phù hợp.

### Sửa

Ưu tiên cursor:

```text
GET /api/host/reviews?status=published&cursor=<createdAt,id>&limit=20
GET /api/admin/reviews?status=reported&cursor=<reportCount,createdAt,id>&limit=20
```

Sort ổn định:

```text
createdAt DESC, _id DESC
```

Admin moderation:

```text
ReportCount DESC, createdAt DESC, _id DESC
```

Indexes:

```js
reviewSchema.index({ SpaceID: 1, Status: 1, createdAt: -1 });
reviewSchema.index({ Status: 1, ReportCount: -1, createdAt: -1 });
```

Nếu denormalize:

```js
reviewSchema.index({ HostID: 1, Status: 1, createdAt: -1 });
```

---

## P1-04 — Query host review dùng danh sách toàn bộ space IDs

Luồng hiện tại:

1. query tất cả space của host;
2. tạo mảng ID;
3. query review với `$in`.

Với host lớn, mảng `$in` có thể lớn và tốn bộ nhớ.

### Giải pháp ngắn hạn

Denormalize `HostID` và `BranchID` vào Review snapshot khi tạo review.

Backfill có kiểm chứng.

### Giải pháp microservices

Catalog Service sở hữu Review và Space, có thể:

- lưu `hostId` trực tiếp trong review;
- duy trì read model;
- không phụ thuộc cross-service join.

---

## P1-05 — Host reply thiếu state policy, audit và concurrency control

Hiện host có thể ghi reply trực tiếp sau ownership check.

Cần quyết định:

- review `removed` có được reply không;
- reply có được sửa vô hạn không;
- có lưu lịch sử chỉnh sửa không;
- có moderation cho reply không;
- có rate limit không;
- có notification cho customer không.

### Đề xuất

State rule:

```text
published/reported/hidden -> host có thể tạo hoặc cập nhật reply
removed -> không cho sửa reply mới
```

Audit:

```text
review_reply_created
review_reply_updated
```

Optimistic concurrency:

```text
expectedVersion
```

Notification qua outbox:

```text
catalog.review-replied.v1
```

---

## P1-06 — Internal note được nhúng trong Booking và cập nhật read-modify-save

### Hiện trạng

Controller:

1. load booking;
2. push vào array;
3. slice 50;
4. save document.

### Rủi ro

- Hai request đồng thời có thể ghi đè/mất note.
- Booking document là hot aggregate; note làm document phình.
- Note không có ID riêng.
- Không có edit/delete/audit.
- Khó phân quyền staff.
- Không có pagination.
- Mỗi lần add trả cả mảng note.

### Sửa ngắn hạn

Nếu chưa tách collection, dùng atomic update:

```js
$push: {
  HostInternalNotes: {
    $each: [note],
    $slice: -50
  }
}
```

Tốt hơn:

```text
HostBookingNote collection
- _id
- BookingID
- HostID
- BranchID
- AuthorID
- AuthorRole
- Body
- createdAt
- editedAt
- deletedAt
```

### Đích service

Note nghiệp vụ tại lễ tân thuộc Booking Service; audit/read UI có thể được Operations consume bằng event.

---

## P1-07 — Incident validation và staff authorization không nhất quán

### Hiện trạng

Route `/api/host/incidents` chỉ cho role `host`.

Controller lại có logic:

```text
if req.hostContext.isStaff ...
```

nhưng route đó không gắn `resolveHostContext`, nên branch-scope staff logic không được sử dụng trong đường route này.

### Sửa

Tách command:

```text
POST /api/host/incidents
POST /api/staff/host/incidents
```

Cả hai gọi cùng use case với actor context:

```js
createIncident({
  hostOwnerId,
  actorId,
  actorRole,
  allowedBranchIds,
  bookingId,
  type,
  description,
  internalNote,
  customerNote,
  idempotencyKey
})
```

Validation:

- bookingId: ObjectId;
- type: enum;
- description: 1..3000;
- internalNote: <= 3000;
- customerNote: <= 3000;
- evidence count/URL limits;
- idempotency key required hoặc fingerprint.

Không trả raw Incident document.

---

## P1-08 — `freeCancelHours=0` bị đổi thành 24

Code kiểu:

```js
Number(req.body.freeCancelHours) || 24
```

khi input là `0` sẽ trả `24`.

### Sửa

```js
const value = Number(req.body.freeCancelHours);
if (!Number.isFinite(value)) {
  throw new ValidationError(...);
}
updates.FreeCancelHours = Math.max(0, Math.min(168, value));
```

Thêm:

```text
runValidators: true
```

cho `findOneAndUpdate`.

### Test

- 0 -> 0;
- 24 -> 24;
- 168 -> 168;
- 169 -> policy: reject hoặc clamp, phải nhất quán;
- `"abc"` -> 400, không tự thành 24;
- null/undefined -> không đổi;
- user khác -> 404/403 không lộ resource.

---

## P1-09 — Thay đổi Space Ops chưa phát event và chưa audit

Các field:

- buffer before;
- cleanup after;
- free cancel;
- instant book

ảnh hưởng trực tiếp tới:

- availability;
- booking conflict;
- cancellation;
- quote;
- customer UX.

Cần:

- audit actor, before/after;
- reason;
- version;
- event;
- cache invalidation;
- update Booking Service local read model.

Event:

```text
catalog.space-booking-policy-updated.v1
```

Payload:

```json
{
  "spaceId": "...",
  "hostId": "...",
  "branchId": "...",
  "policyVersion": 8,
  "bufferBeforeMinutes": 15,
  "cleanupAfterMinutes": 15,
  "freeCancelHours": 24,
  "instantBook": true,
  "changedBy": "...",
  "changedAt": "..."
}
```

Booking Service chỉ nhận version mới hơn.

---

## P1-10 — Push delivery tuần tự, không retry có kiểm soát

Hiện sender lặp từng subscription và `await` tuần tự.

Cần:

- job queue;
- batch/concurrency limit;
- TTL;
- urgency;
- retry backoff;
- max attempts;
- DLQ;
- delivery result;
- lastSuccessAt/lastFailureAt;
- revoke 404/410;
- retry 429/5xx;
- không retry 400 do payload.

Trong Communication Service:

```text
push_delivery_jobs
push_delivery_attempts
push_subscriptions
communication_outbox
processed_messages
```

---

## P1-11 — Optional `web-push` làm feature production không xác định

Code kiểm tra:

```js
try {
  require("web-push")
} catch {
  log warning
}
```

Nhưng package không nằm trong dependencies hiện tại.

### Sửa

Một trong hai:

1. Thêm `web-push` vào dependencies và test startup; hoặc
2. Tắt route/UI push nếu adapter không được cài.

Production phải fail-fast nếu:

```text
WEB_PUSH_ENABLED=true
```

nhưng thiếu:

- package;
- VAPID subject;
- public key;
- private key.

---

## P1-12 — Admin Health đang trở thành God Admin Operations Page

`admin-health.js` đang xử lý:

- system health;
- dead letters;
- payouts;
- refunds;
- review moderation.

Đây là nhiều bounded context:

- operations;
- billing;
- catalog moderation.

### Sửa frontend

Tách page:

```text
/admin/system/health
/admin/operations/dead-letters
/admin/billing/payouts
/admin/billing/refunds
/admin/catalog/reviews
/admin/disputes
```

Admin shell/BFF chỉ tổng hợp navigation và badge count.

### Sửa quyền

Không dùng một quyền `admin` duy nhất lâu dài.

Scopes:

```text
system:read
dead-letter:read
dead-letter:replay
billing:payout:approve
billing:refund:process
catalog:review:moderate
dispute:resolve
```

---

## P1-13 — Financial admin actions thiếu step-up và maker-checker

Approve payout, process refund, resolve dispute là sensitive business flows.

Cần cân nhắc:

- admin 2FA bắt buộc;
- recent authentication;
- re-auth/step-up;
- reason bắt buộc;
- audit log;
- transfer reference;
- evidence;
- idempotency key;
- dual approval/maker-checker theo threshold;
- webhook/provider reconciliation.

Ví dụ:

```text
refund <= 500,000 VND: 1 approver
refund > 500,000 VND: 2 approvers
payout > threshold: finance admin + second approver
```

Không dùng `prompt()` làm giao diện production cho tiền.

---

## P1-14 — Raw Mongoose documents được trả trực tiếp

Nhiều endpoint trả:

```js
res.json({ reviews })
res.json({ incident: doc })
res.json({ space })
```

Rủi ro:

- vô tình lộ field mới trong tương lai;
- contract bị phụ thuộc schema persistence;
- khó chuyển service;
- field legacy lẫn lộn;
- Broken Object Property Level Authorization.

Cần presenter/DTO cho mọi API public/admin.

---

# 6. PHÁT HIỆN P2 — CHẤT LƯỢNG, UX VÀ BẢO TRÌ

## P2-01 — Frontend lặp code imperative

Lặp lại nhiều mẫu:

- `msg()`;
- fetch -> json -> if !ok;
- tạo DOM card;
- loading/empty/error;
- button disable;
- confirm/prompt/alert;
- currency/date formatting.

Tạo client core:

```text
src/client/core/api-client.js
src/client/core/request-state.js
src/client/core/toast.js
src/client/core/dialog.js
src/client/core/format.js
src/client/core/pagination.js
src/client/core/dom.js
```

Tạo feature modules:

```text
src/client/features/reviews/
src/client/features/reception/
src/client/features/push/
src/client/features/membership/
src/client/features/admin-billing/
```

---

## P2-02 — Loading state và double submit

Các nút chưa nhất quán:

- disable khi request;
- spinner;
- chống click hai lần;
- AbortController;
- timeout;
- retry feedback.

Mutation tiền và moderation phải có request state rõ ràng.

---

## P2-03 — Accessibility

Cần bổ sung:

- `aria-pressed` cho filter;
- `aria-live` cho message;
- label thật cho input;
- focus sau moderation/load;
- dialog thay prompt/confirm;
- keyboard access;
- reduced motion;
- contrast;
- table caption;
- status text không chỉ dựa vào màu.

---

## P2-04 — Legacy field fallback lan ra frontend

Ví dụ UI đọc:

```text
Hours / hours
Direction / direction
Type / type
createdAt / CreatedAt
```

Đây là dấu hiệu API chưa có presenter ổn định.

Backend phải normalize DTO. Frontend chỉ đọc một contract.

---

## P2-05 — Error handling không nhất quán

Có nơi dùng:

```text
fetch
WorkHubAPI.api
alert
console.error
msg
silent catch
```

Cần một error envelope:

```json
{
  "error": {
    "code": "REVIEW_NOT_FOUND",
    "message": "Không tìm thấy review.",
    "requestId": "...",
    "details": []
  }
}
```

Frontend map error code sang UX.

---

# 7. KẾ HOẠCH STABILIZATION TRƯỚC MICROservices

Không bắt đầu tạo 8 service trước khi hoàn tất phần này.

## S0 — Bảo vệ Git và baseline

### Công việc

```bash
git status --short
git switch -c refactor/microservices-strangler
```

Nếu đang có thay đổi chưa commit:

```bash
git stash push -u -m "wip-before-microservices-stabilization"
```

hoặc commit nhỏ nếu đã review.

Chạy:

```bash
npm ci
npm run lint:security-ui
npm run lint
npm test
npm run test:transactions
npm run build
npm run audit:prod
npm run indexes:verify
```

Cho Jest đủ timeout; không kết luận fail vì Bash tool timeout 120 giây.

### Artifacts

```text
docs/migration/baseline.md
docs/migration/latest-commit-review.md
MICROSERVICES_MIGRATION_REPORT.md
```

### Exit criteria

- baseline được ghi rõ;
- không mất code;
- branch đúng;
- lỗi cũ và lỗi mới được phân loại.

---

## S1 — Test commit mới

Viết test cho từng endpoint và UI mới.

### Contract tests

```text
GET  /api/host/reviews
POST /api/host/reviews/:reviewId/reply
GET  /api/admin/reviews
PUT  /api/admin/reviews/:reviewId/moderate
GET  /api/host/bookings/:bookingId/notes
POST /api/host/bookings/:bookingId/notes
POST /api/host/incidents
PATCH /api/host/spaces/:spaceId/ops
GET  /api/push/vapid-public-key
POST /api/push/subscribe
POST /api/push/unsubscribe
GET  /api/membership/credits
PUT  /api/admin/disputes/:disputeId/resolve
```

### Security matrix

Mỗi endpoint test:

- unauthenticated;
- customer;
- host owner;
- host non-owner;
- staff allowed branch;
- staff denied branch;
- admin;
- malformed ObjectId;
- missing field;
- oversized field;
- duplicate mutation;
- concurrent mutation.

### Exit criteria

- test xanh;
- contract snapshot có version;
- coverage code mới đạt ngưỡng hợp lý;
- không còn P0 chưa xử lý.

---

## S2 — Sửa consistency và data exposure

- dispute workflow;
- rating published-only;
- DTO/presenter;
- remove customer email;
- atomic/separate notes;
- incident validation;
- space ops 0 bug;
- push validation;
- rate limiting;
- audit events.

---

## S3 — Tách controller/router trong monolith

Đây chưa phải microservices, nhưng là anti-corruption preparation.

```text
modules/reviews/
modules/reception/
modules/push/
modules/membership/
modules/admin-operations/
```

Mục tiêu:

- không thêm code mới vào growth controller;
- route ownership rõ;
- contract không đổi;
- test xanh.

---

# 8. KIẾN TRÚC MICROservices ĐÍCH

## 8.1 Nguyên tắc

Một component chỉ được gọi là microservice nếu:

1. chạy process/container riêng;
2. deploy riêng;
3. scale riêng;
4. có database ownership;
5. không query DB của service khác;
6. không import source/model của service khác;
7. có REST/event contract;
8. có health/readiness/metrics/traces/logs;
9. có test riêng;
10. có rollback riêng;
11. failure được cô lập;
12. có owner/runbook/SLO.

Chỉ chia folder không phải microservices.

## 8.2 Sơ đồ đích

```text
Browser / Mobile / Partner
            |
            v
      API Gateway / Edge
       |             |
       v             v
    Web BFF       Public API
       |
       +--------------------------+
       |        |       |         |
       v        v       v         v
   Identity  Catalog  Booking   Billing
       |        |       |         |
       +--------+-------+---------+
                    |
                RabbitMQ
                    |
       +------------+-------------+
       |            |             |
       v            v             v
 Communication  Operations    Analytics
       |
    Web Push / Email / Realtime
```

## 8.3 Service tối thiểu

### `identity-service`

Sở hữu:

- users;
- credentials;
- session;
- JWT/JWKS;
- role;
- email verification;
- password reset;
- 2FA;
- WebAuthn;
- force logout.

Không sở hữu:

- host business profile;
- booking;
- payment;
- push subscription.

### `catalog-service`

Sở hữu:

- host profile;
- branch;
- space;
- amenities;
- listing image metadata;
- review;
- review moderation;
- host reply;
- search read model;
- public host/listing.

Commit mới:

- host review list/reply -> Catalog.
- admin review moderation -> Catalog.
- space booking policy source -> Catalog.

### `booking-service`

Sở hữu:

- booking;
- slot;
- hold;
- availability;
- recurring/group booking;
- check-in/no-show/checkout;
- host booking note;
- incident liên quan booking;
- cancellation state;
- reschedule.

Commit mới:

- reception note -> Booking.
- incident -> Booking hoặc Operations incident subdomain; khuyến nghị Booking sở hữu aggregate gốc, Operations consume read model.
- reception screen query -> Booking.

### `billing-service`

Sở hữu:

- quote;
- pricing;
- coupons;
- payment;
- refund;
- payout;
- ledger;
- membership;
- credit ledger;
- dispute financial resolution.

Commit mới:

- membership credits -> Billing.
- admin payout/refund -> Billing.
- dispute refund workflow -> Billing phối hợp Operations/Dispute.

### `communication-service`

Sở hữu:

- notification;
- email delivery;
- Web Push subscription;
- push delivery;
- user communication preference nếu quyết định tách khỏi Identity;
- messages.

Commit mới:

- PushSubscription -> Communication.
- VAPID/web-push -> Communication.
- review reply notification -> Communication consume event.
- incident notification -> Communication consume event.

### `operations-service`

Sở hữu hoặc tổng hợp:

- dead-letter UI;
- audit read model;
- admin operational actions;
- export jobs;
- reconciliation orchestration;
- system health aggregation;
- incident operational read model;
- dispute case management nếu dispute được coi là cross-domain case.

Không được sở hữu payment ledger hoặc booking aggregate.

### `content-service`

Sở hữu:

- CMS;
- SEO redirect;
- sitemap source;
- i18n content;
- public policy content.

### `analytics-service` — làm sau

Sở hữu read models:

- conversion;
- RUM;
- rating trend;
- host dashboard aggregate;
- revenue analytics đã được cấp quyền.

Không nằm trong booking/payment critical path.

---

# 9. DATA OWNERSHIP

## 9.1 Database logic

Local có thể cùng Mongo cluster nhưng database riêng:

```text
workhub_identity
workhub_catalog
workhub_booking
workhub_billing
workhub_communication
workhub_operations
workhub_content
workhub_analytics
```

Mỗi service dùng Mongo credential riêng.

## 9.2 Bảng ownership

| Entity hiện tại | Service đích | Ghi chú |
|---|---|---|
| User/Credential/Session/WebAuthn | Identity | Không chia sẻ model |
| Host_Profile | Catalog | Map legacy field |
| Branch/Space/Amenity | Catalog | Space policy phát event |
| Review | Catalog | Thêm hostId snapshot/read model |
| Booking/BookingSlot | Booking | Không populate User/Space xuyên DB |
| HostInternalNotes | Booking | Tách collection |
| Incident | Booking | Operations có read model |
| Payment_History/Refund/Payout/Ledger | Billing | Append-only ledger |
| Membership/CreditLedger | Billing | Idempotent command |
| PushSubscription | Communication | Secret handling |
| Notification/Message | Communication | Event-driven |
| DeadLetter/Job | Service owner + Operations read | Không gom mọi worker |
| CMS/SEO/i18n | Content | Public cache |
| RUM/Funnel | Analytics | Async only |

## 9.3 Không được làm

```text
booking-service -> query workhub_catalog.spaces
billing-service -> query workhub_booking.bookings
catalog-service -> query workhub_identity.users
communication-service -> query toàn bộ DB để tìm email
```

Thay bằng:

- typed synchronous API khi cần ngay;
- event;
- local read model;
- immutable snapshot.

---

# 10. ANTI-CORRUPTION LAYER CHO FIELD LEGACY

Database hiện dùng nhiều field PascalCase/underscore:

```text
FullName
HostID
SpaceID
Payment_History
Host_Profile
```

Không rename trực tiếp trong migration đầu.

Repository mapper:

```js
function toDomain(doc) {
  return {
    id: String(doc._id),
    hostId: doc.HostID ? String(doc.HostID) : null,
    spaceId: doc.SpaceID ? String(doc.SpaceID) : null,
    fullName: doc.FullName || "",
    createdAt: doc.createdAt,
  };
}

function toPersistence(entity) {
  return {
    HostID: entity.hostId,
    SpaceID: entity.spaceId,
    FullName: entity.fullName,
  };
}
```

API DTO chỉ camelCase.

Event payload chỉ camelCase.

---

# 11. MONOREPO ĐÍCH

```text
WorkHub/
├─ apps/
│  ├─ api-gateway/
│  │  ├─ src/
│  │  ├─ test/
│  │  ├─ Dockerfile
│  │  └─ package.json
│  ├─ web-bff/
│  │  ├─ src/
│  │  ├─ views/
│  │  ├─ client/
│  │  ├─ public/dist/
│  │  ├─ test/
│  │  ├─ Dockerfile
│  │  └─ package.json
│  └─ legacy-monolith/
│
├─ services/
│  ├─ identity-service/
│  ├─ catalog-service/
│  ├─ booking-service/
│  ├─ billing-service/
│  ├─ communication-service/
│  ├─ operations-service/
│  ├─ content-service/
│  └─ analytics-service/
│
├─ packages/
│  ├─ contracts/
│  │  ├─ openapi/
│  │  ├─ asyncapi/
│  │  └─ schemas/
│  ├─ observability/
│  ├─ security/
│  ├─ eslint-config/
│  └─ test-utils/
│
├─ infra/
│  ├─ gateway/
│  ├─ rabbitmq/
│  ├─ mongodb/
│  ├─ redis/
│  ├─ otel-collector/
│  ├─ prometheus/
│  ├─ grafana/
│  └─ loki/
│
├─ tests/
│  ├─ e2e/
│  ├─ contract/
│  ├─ resilience/
│  ├─ security/
│  └─ performance/
│
├─ docs/
│  ├─ architecture/
│  ├─ adr/
│  ├─ migration/
│  ├─ runbooks/
│  └─ service-catalog/
│
├─ package.json
├─ package-lock.json
└─ docker-compose.yml
```

Dùng npm workspaces giai đoạn đầu.

Không dùng shared business model package.

`packages/contracts` chỉ chứa:

- schema;
- OpenAPI;
- AsyncAPI;
- generated client;
- error envelope.

---

# 12. CẤU TRÚC CHUẨN MỖI SERVICE

Ví dụ `catalog-service`:

```text
services/catalog-service/
├─ src/
│  ├─ bootstrap/
│  │  ├─ create-app.js
│  │  ├─ create-worker.js
│  │  ├─ container.js
│  │  └─ shutdown.js
│  ├─ config/
│  ├─ api/
│  │  ├─ routes/
│  │  ├─ controllers/
│  │  ├─ validation/
│  │  ├─ policies/
│  │  └─ presenters/
│  ├─ application/
│  │  ├─ commands/
│  │  ├─ queries/
│  │  ├─ handlers/
│  │  └─ ports/
│  ├─ domain/
│  │  ├─ aggregates/
│  │  ├─ entities/
│  │  ├─ value-objects/
│  │  ├─ events/
│  │  ├─ policies/
│  │  └─ errors/
│  ├─ infrastructure/
│  │  ├─ persistence/
│  │  ├─ messaging/
│  │  ├─ cache/
│  │  └─ clients/
│  └─ workers/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ component/
│  └─ contract/
├─ openapi.yaml
├─ asyncapi.yaml
├─ Dockerfile
├─ package.json
└─ README.md
```

Dependency:

```text
route/consumer
  -> application
  -> domain
  -> port
  -> infrastructure adapter
```

Domain không import Express/Mongoose/RabbitMQ/Stripe/Cloudinary/Socket/EJS.

---

# 13. API GATEWAY VÀ WEB BFF

## 13.1 Gateway

Gateway là public entry duy nhất.

Trách nhiệm:

- route;
- request ID;
- trace propagation;
- TLS;
- edge rate limit;
- body limit;
- CORS;
- coarse authentication;
- canary;
- rollback routing;
- legacy URL compatibility.

Không chứa business logic.

## 13.2 Route map

```text
/api/auth/*                -> identity-service
/api/sessions/*            -> identity-service

/api/hosts/*               -> catalog-service
/api/branches/*            -> catalog-service
/api/spaces/*              -> catalog-service
/api/reviews/*             -> catalog-service
/api/search/*              -> catalog-service

/api/bookings/*            -> booking-service
/api/reception/*           -> booking-service
/api/incidents/*           -> booking-service
/api/check-in/*            -> booking-service

/api/payments/*            -> billing-service
/api/refunds/*             -> billing-service
/api/payouts/*             -> billing-service
/api/membership/*          -> billing-service
/api/credits/*             -> billing-service

/api/push/*                -> communication-service
/api/notifications/*       -> communication-service
/api/messages/*            -> communication-service

/api/admin/operations/*    -> operations-service
/api/content/*             -> content-service
```

Trong migration, route chưa extract proxy vào legacy monolith.

## 13.3 Web BFF

Render EJS và aggregate API.

Không query Mongo.

Tách:

```text
customer BFF routes
host BFF routes
admin BFF routes
```

Admin page mới:

```text
/admin/catalog/reviews
/admin/billing/refunds
/admin/billing/payouts
/admin/operations/dead-letters
/admin/system/health
```

---

# 14. EVENT CATALOG ĐỀ XUẤT

Event envelope:

```json
{
  "eventId": "uuid",
  "eventType": "catalog.review-replied.v1",
  "occurredAt": "2026-07-24T00:00:00.000Z",
  "producer": "catalog-service",
  "aggregateId": "review-id",
  "aggregateVersion": 3,
  "correlationId": "uuid",
  "causationId": "uuid",
  "traceId": "trace-id",
  "data": {}
}
```

## Catalog

```text
catalog.host-updated.v1
catalog.branch-updated.v1
catalog.space-updated.v1
catalog.space-booking-policy-updated.v1
catalog.review-created.v1
catalog.review-reported.v1
catalog.review-moderated.v1
catalog.review-replied.v1
catalog.rating-recalculated.v1
```

## Booking

```text
booking.hold-created.v1
booking.hold-expired.v1
booking.created.v1
booking.confirmed.v1
booking.checked-in.v1
booking.checked-out.v1
booking.no-show.v1
booking.cancelled.v1
booking.note-added.v1
booking.incident-created.v1
booking.incident-closed.v1
```

## Billing

```text
billing.quote-created.v1
billing.payment-succeeded.v1
billing.payment-failed.v1
billing.refund-requested.v1
billing.refund-processing.v1
billing.refund-completed.v1
billing.refund-failed.v1
billing.payout-requested.v1
billing.payout-completed.v1
billing.membership-activated.v1
billing.credit-ledger-entry-created.v1
```

## Communication

```text
communication.push-subscription-created.v1
communication.push-subscription-revoked.v1
communication.notification-delivered.v1
communication.notification-failed.v1
```

## Operations

```text
operations.dead-letter-created.v1
operations.dead-letter-replayed.v1
operations.dispute-opened.v1
operations.dispute-resolution-requested.v1
operations.dispute-resolved.v1
operations.dispute-resolution-failed.v1
```

---

# 15. RABBITMQ, OUTBOX VÀ INBOX

## 15.1 Yêu cầu RabbitMQ

- durable exchange;
- durable/quorum queue phù hợp;
- persistent message;
- publisher confirms;
- manual consumer ack;
- prefetch;
- retry queue;
- exponential backoff;
- DLX;
- poison message handling;
- idempotent consumer.

Không giả định exactly-once.

## 15.2 Transactional Outbox

Trong cùng local transaction:

```text
update aggregate
insert outbox event
commit
```

Publisher:

```text
claim -> publish -> wait confirm -> mark published
```

## 15.3 Inbox/dedup

Consumer:

```text
check processed_messages(eventId)
execute local transaction
record eventId
commit
ack
```

Nếu event đã xử lý:

```text
ack + no-op
```

---

# 16. SAGA QUAN TRỌNG

## 16.1 Booking + Payment

```text
Booking reserve slot
-> booking.hold-created
-> Billing create payment session
-> payment success
-> billing.payment-succeeded
-> Booking confirm
-> booking.confirmed
-> Communication notify
```

Failure:

```text
billing.payment-failed
-> Booking expire hold
-> release slot
```

## 16.2 Dispute + Refund

```text
Operations claims dispute resolution
-> operations.dispute-resolution-requested
-> Billing validates refund
-> Billing processes provider/manual refund
-> billing.refund-completed
-> Operations marks dispute resolved
-> Communication notifies both parties
```

Failure:

```text
billing.refund-failed
-> Operations marks resolution_failed
-> create admin retry/manual task
```

## 16.3 Review moderation

```text
Admin moderates review
-> Catalog updates review state
-> outbox review-moderated
-> rating worker recomputes published-only
-> communication notifies author/host if policy requires
-> analytics updates read model
```

## 16.4 Space policy propagation

```text
Catalog updates policy version N
-> event
-> Booking consumes if version > localVersion
-> updates local space policy read model
```

---

# 17. SECURITY MODEL

## 17.1 Authentication

Identity phát asymmetric JWT.

- private key chỉ Identity;
- services verify qua JWKS;
- `aud` theo service;
- short-lived token;
- session revocation;
- tokenVersion hoặc session ID;
- 2FA/WebAuthn.

## 17.2 Authorization

Gateway auth không thay thế service authorization.

Mỗi service kiểm tra:

- role;
- scope;
- tenant;
- ownership;
- branch;
- resource;
- status transition.

Mọi endpoint có object ID phải có BOLA test.

## 17.3 Sensitive admin flows

Step-up:

```text
refund
payout
force logout
review remove
dead-letter replay
dispute resolution
```

Audit log append-only:

```text
actorId
actorRole
action
resourceType
resourceId
beforeHash
afterHash
reason
requestId
traceId
ip
userAgent
occurredAt
```

## 17.4 Input validation

Zod tại boundary.

Không dùng raw `req.body` trong domain/service.

## 17.5 Secrets

- secret manager production;
- không log;
- không commit;
- rotation;
- separate VAPID/JWT/webhook/session keys;
- push auth key protected;
- service DB credential riêng.

---

# 18. OBSERVABILITY

Mỗi service:

```text
GET /health/live
GET /health/ready
GET /metrics
```

OpenTelemetry:

- HTTP server/client;
- Mongo;
- RabbitMQ publish/consume;
- exception;
- service/resource metadata;
- traceparent;
- correlation.

Log fields:

```text
timestamp
level
service.name
service.version
environment
requestId
traceId
spanId
correlationId
eventId
actorId
resourceId
errorCode
durationMs
```

Không log:

- JWT;
- password;
- TOTP;
- VAPID private key;
- push auth key;
- full endpoint nếu không cần;
- payment credential;
- API key raw.

Metrics mới cho commit:

```text
review_moderation_total
review_reply_total
rating_recalculation_failures_total
reception_notes_created_total
incidents_created_total
push_subscriptions_active
push_delivery_total
push_delivery_failures_total
dispute_resolution_total
dispute_refund_failures_total
space_policy_updates_total
```

---

# 19. TESTING CHIẾN LƯỢC

## 19.1 Unit

- review state policy;
- rating published-only;
- space policy parsing;
- incident validation;
- push endpoint validator;
- dispute state machine;
- saga compensation;
- event schema.

## 19.2 Integration

- Mongo repository;
- unique/index;
- outbox transaction;
- inbox dedup;
- RabbitMQ retry;
- refund transaction;
- concurrent notes;
- concurrent moderation.

## 19.3 Contract

- OpenAPI provider test;
- BFF consumer-driven contract;
- event JSON Schema;
- backward compatibility;
- error envelope.

## 19.4 E2E

Customer:

- create booking;
- membership credit;
- receive review reply notification;
- enable/disable push.

Host:

- list/reply review;
- reception note;
- incident;
- space policy;
- check-in.

Admin:

- moderate review;
- refund;
- payout;
- dispute;
- dead-letter.

## 19.5 Resilience

- Rabbit down;
- Mongo down;
- provider timeout;
- duplicate event;
- out-of-order event;
- process crash after DB commit before publish;
- crash after handling before ack;
- Web Push 410/429/500;
- Billing unavailable during dispute resolution.

---

# 20. CI/CD

Root scripts mục tiêu:

```json
{
  "scripts": {
    "lint": "npm run lint --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "test:contract": "...",
    "test:e2e": "...",
    "test:security": "...",
    "test:resilience": "...",
    "routes:check": "node scripts/detect-duplicate-routes.js"
  }
}
```

Mỗi service pipeline:

1. install;
2. lint;
3. unit;
4. integration;
5. contract;
6. audit;
7. SBOM;
8. container build;
9. image scan;
10. deploy;
11. smoke;
12. rollback nếu fail.

Không yêu cầu Kubernetes trong phase đầu. Docker Compose trước.

---

# 21. MIGRATION PHASES

## M0 — Stabilization

Hoàn tất S0-S3.

Exit:

- P0 fixed;
- tests green;
- route duplicate inventory;
- API contract frozen.

## M1 — Monorepo + legacy app

- npm workspaces;
- move monolith vào `apps/legacy-monolith`;
- compatibility start script;
- no behavior change.

Exit:

- tất cả URL chạy như cũ;
- test xanh.

## M2 — API Gateway pass-through

- Gateway proxy 100% vào monolith.
- request/trace ID.
- canary config.
- timeout/body/rate limit.

Exit:

- E2E qua gateway giống direct monolith;
- rollback route tested.

## M3 — Messaging platform

- RabbitMQ;
- outbox/inbox reference;
- event envelope;
- OTel messaging trace;
- DLQ UI skeleton.

Exit:

- crash/retry/dedup test xanh.

## M4 — Communication Service

Extract:

- PushSubscription;
- Web Push;
- notification delivery;
- email worker.

Monolith phát event.

Exit:

- push delivery độc lập;
- no direct PushSubscription model in monolith path;
- rollback flag.

## M5 — Content Service

Extract CMS/SEO/i18n/public policy.

## M6 — Identity Service

Extract auth/session/2FA/WebAuthn.

Rủi ro cao; contract freeze nghiêm ngặt.

## M7 — Catalog Service

Extract host/branch/space/review/search.

Commit mới review features chuyển ở đây.

Exit:

- review moderation/reply live;
- rating read model correct;
- space policy event.

## M8 — Billing Service

Extract payment/refund/payout/membership/credit/ledger.

Exit:

- reconciliation match;
- provider webhook verified;
- dispute refund saga support.

## M9 — Booking Service

Extract booking/slot/hold/reception/note/incident.

Exit:

- concurrency test;
- no double booking;
- staff branch authorization;
- local catalog read model.

## M10 — Operations Service

Extract dead-letter UI/audit/reconciliation/dispute case.

## M11 — Web BFF

Move EJS/page routes.

No DB access.

## M12 — Analytics

Only after event contracts stable.

## M13 — Retire monolith

Chỉ khi:

- no public route;
- no domain worker;
- no DB ownership;
- production observation window passed;
- rollback tested.

---

# 22. BACKLOG CỤ THỂ

## Stabilization

- [ ] `WH-STAB-001` Add tests for latest commit.
- [ ] `WH-STAB-002` Fix dispute/refund consistency.
- [ ] `WH-STAB-003` Fix published-only rating.
- [ ] `WH-STAB-004` Await/retry rating projection.
- [ ] `WH-STAB-005` Remove customer email from host review DTO.
- [ ] `WH-STAB-006` Add review presenters.
- [ ] `WH-STAB-007` Add review pagination/index.
- [ ] `WH-STAB-008` Add host reply policy/audit.
- [ ] `WH-STAB-009` Move notes to collection or atomic push.
- [ ] `WH-STAB-010` Add staff note/incident authorization.
- [ ] `WH-STAB-011` Validate incident payload.
- [ ] `WH-STAB-012` Fix `freeCancelHours=0`.
- [ ] `WH-STAB-013` Add space policy audit/event.
- [ ] `WH-STAB-014` Harden push endpoint.
- [ ] `WH-STAB-015` Add web-push dependency/fail-fast.
- [ ] `WH-STAB-016` Add push queue/retry.
- [ ] `WH-STAB-017` Detect duplicate routes.
- [ ] `WH-STAB-018` Split admin health page.
- [ ] `WH-STAB-019` Add step-up for finance admin.
- [ ] `WH-STAB-020` Add CI status checks.

## Microservices platform

- [ ] `WH-MICRO-001` npm workspaces.
- [ ] `WH-MICRO-002` legacy monolith app.
- [ ] `WH-MICRO-003` API Gateway.
- [ ] `WH-MICRO-004` Web BFF skeleton.
- [ ] `WH-MICRO-005` RabbitMQ topology.
- [ ] `WH-MICRO-006` outbox SDK/reference.
- [ ] `WH-MICRO-007` inbox/dedup.
- [ ] `WH-MICRO-008` event schemas.
- [ ] `WH-MICRO-009` OpenTelemetry.
- [ ] `WH-MICRO-010` service template.
- [ ] `WH-MICRO-011` contract CI.
- [ ] `WH-MICRO-012` Docker Compose.
- [ ] `WH-MICRO-013` service catalog.
- [ ] `WH-MICRO-014` runbooks.

## Service extraction

- [ ] `WH-COMM-001` Push subscriptions.
- [ ] `WH-COMM-002` Push delivery worker.
- [ ] `WH-COMM-003` Notification consumer.
- [ ] `WH-CATALOG-001` Review API.
- [ ] `WH-CATALOG-002` Rating projection.
- [ ] `WH-CATALOG-003` Space policy.
- [ ] `WH-BILL-001` Membership credit.
- [ ] `WH-BILL-002` Refund/payout.
- [ ] `WH-BILL-003` Dispute refund saga.
- [ ] `WH-BOOK-001` Reception query.
- [ ] `WH-BOOK-002` Host notes.
- [ ] `WH-BOOK-003` Incident.
- [ ] `WH-OPS-001` Dead-letter UI.
- [ ] `WH-OPS-002` Dispute case.
- [ ] `WH-OPS-003` Audit projection.

---

# 23. DEFINITION OF DONE

## Commit mới được coi là ổn định khi

- test mới tồn tại;
- no P0;
- review privacy correct;
- rating correct;
- refund consistency correct;
- push hardened;
- route duplicates resolved;
- lint/test/build pass;
- CI status visible.

## Microservices được coi là thật khi

- mỗi service deploy độc lập;
- DB ownership riêng;
- no cross-service DB/model;
- gateway public entry;
- BFF no DB;
- outbox/inbox;
- idempotent consumer;
- Saga cho distributed workflow;
- OpenAPI/AsyncAPI;
- observability;
- rollback;
- runbook;
- SLO.

---

# 24. MASTER PROMPT THỰC THI CHO CLAUDE

```text
Bạn là Principal Engineer phụ trách WorkHub.

Đọc toàn bộ WORKHUB_MASTER_REVIEW_MICROSERVICES_PLAN.md và thực hiện theo đúng thứ tự.

QUY TẮC:
1. Không sửa trực tiếp main.
2. Không reset, checkout hoặc xóa thay đổi của người dùng.
3. Không push/merge/rewrite history.
4. Không big-bang rewrite.
5. Không tạo hàng loạt service rỗng.
6. Không thay API URL hoặc response contract nếu chưa có compatibility adapter.
7. Không rename trực tiếp MongoDB legacy fields.
8. Không dùng shared database hoặc import Mongoose model xuyên service.
9. Không tuyên bố hoàn thành nếu test chưa chạy.
10. Mỗi phase có rollback và bằng chứng.

BẮT ĐẦU:
- kiểm tra git status/branch;
- đọc commit 3a2db51ee2a11f3c14461c70cba72a3554347aa8 và diff;
- chạy baseline;
- viết test cho toàn bộ chức năng commit mới;
- sửa toàn bộ P0;
- sau đó P1;
- cập nhật MICROSERVICES_MIGRATION_REPORT.md.

Chưa được bắt đầu M1 cho đến khi:
- lint pass;
- tests commit mới pass;
- full test pass hoặc baseline failure được chứng minh;
- build pass;
- P0 = 0.

Khi stabilization đạt:
- triển khai M1, M2, M3 tuần tự;
- mỗi phase commit nhỏ;
- dừng và báo cáo nếu có quyết định data ownership không thể suy ra an toàn.

Khi extract service:
- characterization tests trước;
- shadow/canary;
- reconciliation;
- rollback;
- chỉ cutover khi có bằng chứng.

Nếu tool call lỗi:
- thử cách đơn giản hơn;
- không bỏ qua validation/test;
- không dừng toàn bộ nhiệm vụ chỉ vì một agent/tool lỗi.

Sau mỗi phase, báo:
- file thay đổi;
- contract giữ lại;
- lệnh chạy;
- kết quả;
- lỗi còn lại;
- rollback;
- phase tiếp theo.
```

---

# 25. TÀI LIỆU THAM KHẢO CHÍNH THỨC

- AWS Prescriptive Guidance — Strangler Fig Pattern  
  https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-decomposing-monoliths/strangler-fig.html

- AWS Prescriptive Guidance — Transactional Outbox  
  https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html

- AWS Prescriptive Guidance — Saga Pattern  
  https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/saga-pattern.html

- Microsoft Azure Architecture Center — Microservices Architecture Style  
  https://learn.microsoft.com/en-us/azure/architecture/microservices/

- Microsoft Azure Architecture Center — API Gateway  
  https://learn.microsoft.com/en-us/azure/architecture/microservices/design/gateway

- RabbitMQ — Consumer Acknowledgements and Publisher Confirms  
  https://www.rabbitmq.com/docs/confirms

- RabbitMQ — Quorum Queues  
  https://www.rabbitmq.com/docs/quorum-queues

- OpenTelemetry Documentation  
  https://opentelemetry.io/docs/

- OpenTelemetry Semantic Conventions  
  https://opentelemetry.io/docs/concepts/semantic-conventions/

- OWASP API Security Top 10 2023  
  https://owasp.org/API-Security/editions/2023/en/0x11-t10/

- OWASP API1 Broken Object Level Authorization  
  https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

- OWASP API3 Broken Object Property Level Authorization  
  https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/

- OWASP Node.js Security Cheat Sheet  
  https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html

- OWASP Input Validation Cheat Sheet  
  https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html

- MDN — PushManager.subscribe()  
  https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe

---

# 26. GHI CHÚ CUỐI

Mục tiêu không phải tạo nhiều container để trông “xịn”. Mục tiêu là:

- ranh giới nghiệp vụ rõ;
- dữ liệu có chủ sở hữu;
- triển khai độc lập;
- failure cô lập;
- consistency được thiết kế;
- bảo mật kiểm chứng được;
- vận hành quan sát được;
- migration rollback được.

Commit mới có nhiều chức năng hữu ích. Việc đúng tiếp theo không phải bỏ chúng đi, mà là:

1. khóa hành vi bằng test;
2. sửa consistency/security;
3. tách boundary;
4. đưa từng boundary sang service thật;
5. giữ hệ thống hoạt động trong toàn bộ quá trình.
