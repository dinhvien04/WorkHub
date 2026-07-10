# WORKHUB MASTER PRODUCT & IMPLEMENTATION PROMPT

**Mục tiêu:** nâng cấp WorkHub thành nền tảng đặt chỗ co-working space dễ dùng nhất có thể, giao diện đẹp, tải cực nhanh, SEO tốt, bảo mật cao, code dễ bảo trì và sẵn sàng mở rộng.

**Repository:** `https://github.com/dinhvien04/WorkHub`  
**Baseline review:** commit `1f8b0a3580cea5272dde335ae56c7e89dfaead8a`

> Tài liệu này vừa là đặc tả sản phẩm, vừa là prompt thực thi cho Grok/AI. Không triển khai tất cả trong một commit; phải làm theo phase, có test, migration, đo hiệu năng và báo cáo thật.

## 0. Vai trò của AI thực hiện

- Senior Product Manager.
- Senior UX/UI Designer và Design System Engineer.
- Senior Node.js/Express Engineer.
- MongoDB Data Architect.
- Application Security Engineer.
- Technical SEO Specialist.
- Web Performance Engineer.
- Accessibility Specialist.
- QA Automation Engineer.
- DevOps/SRE Engineer.

AI phải đọc code hiện tại, nhận diện phần đã có, sửa blocker trước, thiết kế dữ liệu/API/UI, triển khai theo phase, viết test và không tuyên bố hoàn thành nếu chưa chạy kiểm tra.

## 1. Nguyên tắc sản phẩm

- Ưu tiên theo thứ tự: an toàn → chính xác → dễ hiểu → ít thao tác → nhanh → đẹp → mở rộng.
- Guest được xem giá, ảnh, review và lịch trống trước khi đăng nhập.
- Chỉ yêu cầu đăng nhập khi người dùng cần lưu, đặt chỗ hoặc thanh toán.
- Luồng booking cốt lõi tối đa 3 bước.
- Mỗi màn hình chỉ có một CTA chính nổi bật.
- Không yêu cầu nhập lại dữ liệu hệ thống đã có.
- Không làm mất dữ liệu form khi lỗi mạng hoặc validation.
- Mọi khu vực đều có loading, skeleton, empty, error và success state.
- Mobile-first; desktop không được là điều kiện để dùng đủ chức năng.
- Tính năng nâng cao phải dùng progressive disclosure, không nhồi hết lên một màn hình.
- Không thêm tính năng chỉ để trông nhiều; mỗi tính năng phải giải quyết một mục tiêu người dùng.

### 1.1. Chỉ tiêu trải nghiệm

```text
Core Web Vitals p75:
LCP <= 2.5s
INP <= 200ms
CLS <= 0.1

Mục tiêu nội bộ:
TTFB public page p75 <= 800ms
API read p95 <= 500ms
API write p95 <= 800ms
Search p95 <= 700ms
Error rate < 1%
Availability >= 99.9%
```

### 1.2. Chỉ tiêu accessibility

- Đạt WCAG 2.2 AA.
- Điều hướng đầy đủ bằng bàn phím.
- Focus rõ và không bị sticky header/modal che.
- Form có label, thông báo lỗi liên kết đúng field.
- Không dùng màu là tín hiệu duy nhất.
- Hỗ trợ zoom 200%, reflow mobile và prefers-reduced-motion.

### 1.3. Chỉ tiêu bảo mật

- Hướng tới OWASP ASVS 5.0 Level 2.
- Mọi API kiểm tra authentication, role, permission và ownership.
- Không tin amount, role, userId, hostId hoặc status từ client.
- Không lưu JWT trong localStorage.
- Không chèn dữ liệu người dùng qua innerHTML.
- Không lưu dữ liệu thẻ thanh toán.
- Có audit log, backup và restore drill.

## 2. Nền tảng hiện có cần giữ

- Node.js, Express, EJS, MongoDB.
- Customer, host, admin.
- Search, booking, payment history, review.
- Branch/space management.
- Host verification.
- HttpOnly cookie, CSRF, rate limit, tokenVersion.
- Booking slot và payment idempotency.
- Payment verify/reject API.
- Audit log, Jest/Supertest và GitHub Actions cơ bản.

Không được viết lại phần đang đúng chỉ để đổi phong cách. Mọi thay đổi lớn phải có lý do, migration và regression test.

## 3. PHASE 0 — Blocker phải sửa trước

- [ ] Xóa stored XSS còn lại trong `admin-main.js`, `host-dashboard.js`, `host-spaces.js`.
- [ ] Thay renderer có dữ liệu user bằng `createElement`, `textContent`, `replaceChildren`, `addEventListener`.
- [ ] Loại bỏ inline `onclick`, `onerror`, `onchange` chứa dữ liệu động.
- [ ] Xóa biến `token` legacy và mọi `Bearer ${token}` ở frontend.
- [ ] Bảo vệ toàn bộ admin page bằng page middleware, không chỉ bảo vệ API.
- [ ] Xóa route admin khai báo trùng.
- [ ] Sửa host report: actual revenue chỉ từ payment `successful`.
- [ ] Sửa host dashboard dùng đúng `pendingAmount`, `refundedAmount`.
- [ ] Nối UI verify/reject payment vào API hiện có.
- [ ] Customer phải thấy 'đang chờ xác minh', không thấy 'thanh toán thành công' khi payment còn pending.
- [ ] QR/payment summary phải lấy `TotalAmount` và `DepositAmount` từ booking server response.
- [ ] Sửa payment verify concurrency để invariant `successfulPaid <= TotalAmount` luôn đúng.
- [ ] Chọn chính sách slot boundary rõ ràng và validate cả frontend/backend.
- [ ] Nâng CSRF thành signed/session-bound token hoặc synchronizer token.
- [ ] Loại `'unsafe-inline'` khỏi CSP bằng nonce/hash và external event listeners.
- [ ] CI phải có workflow run thật và fail khi lint/test/high-severity audit fail.

## 4. Personas và vai trò

### Guest

- Khám phá
- Tìm kiếm
- So sánh
- Xem lịch trống
- Chia sẻ
- Bắt đầu booking

### Customer

- Đặt nhanh
- Thanh toán rõ
- Theo dõi
- Đổi/hủy
- Check-in
- Review
- Nhận hỗ trợ

### Host owner

- Đăng địa điểm
- Quản lý lịch
- Booking
- Payment
- Staff
- Finance
- Tăng hiển thị

### Host manager

- Vận hành branch/space
- Booking
- Calendar
- Customer support

### Receptionist

- Danh sách hôm nay
- Scan QR
- Check-in/out
- Ghi chú

### Finance staff

- Payment verification
- Refund
- Reconciliation
- Export

### Content editor

- Ảnh
- Mô tả
- SEO listing
- FAQ

### Admin

- Duyệt host
- Moderation
- Dispute
- Finance
- SEO
- Audit
- System health

## 5. Information architecture

### 5.1. Public navigation

```text
Trang chủ
Tìm không gian
Theo thành phố
Theo loại không gian
Ưu đãi
Hướng dẫn
Dành cho chủ địa điểm
Trợ giúp
```

### 5.2. Customer mobile bottom navigation

```text
Khám phá
Lịch đặt
Yêu thích
Thông báo
Tài khoản
```

### 5.3. Host navigation

```text
Tổng quan
Lịch
Booking
Không gian
Tài chính
Nhân viên
Cài đặt
```

### 5.4. Admin navigation

```text
Tổng quan
Người dùng
Host
Địa điểm
Booking
Thanh toán
Tranh chấp
Review
Nội dung
SEO
Audit
Hệ thống
```

## 6. Chức năng public/guest

- Homepage có hero search: địa điểm, ngày, giờ, loại phòng, số người.
- Địa điểm nổi bật, thành phố phổ biến, không gian gần bạn, giá tốt, listing mới.
- Giải thích 3 bước sử dụng, cam kết an toàn, review thật, CTA dành cho host.
- Search autocomplete cho city, district, branch, landmark, type, amenity.
- Search history và popular suggestion; debounce và AbortController.
- Geolocation chỉ xin quyền sau khi người dùng bấm; có fallback thủ công.
- Search result có list/map và split view desktop khi không làm chậm.
- Filter state phản ánh lên URL và hoạt động với back/forward.
- Sort: phù hợp, gần, giá thấp/cao, rating, phổ biến, mới.
- Zero-result gợi ý đổi giờ, mở rộng bán kính, xóa filter và ngày gần nhất còn chỗ.
- Compare tối đa 3 listing.
- Favorites tạm cho guest, merge an toàn sau login.
- Share qua copy link, Web Share API, QR và social preview.

### 6.1. Bộ lọc

- Khoảng giá.
- Ngày/giờ.
- Số người.
- Khoảng cách.
- Rating.
- Loại phòng.
- Instant booking.
- Free cancellation.
- Có hóa đơn.
- Wi-Fi, điều hòa, máy chiếu, màn hình, whiteboard.
- Parking, accessibility, 24/7, yên tĩnh, gọi video, sự kiện.

## 7. Trang chi tiết branch/space

- [ ] URL slug thân thiện, không public URL chỉ có ObjectId.
- [ ] Above-the-fold có tên, khu vực, rating, giá từ, ảnh, availability CTA và chính sách ngắn.
- [ ] Gallery AVIF/WebP, srcset, dimension cố định, lightbox, keyboard, swipe và lazy load.
- [ ] Mô tả, tiện nghi, capacity, loại phòng, giờ mở cửa, chính sách, parking, accessibility.
- [ ] Map, hướng dẫn đi lại, landmark, thông tin host.
- [ ] Availability calendar realtime, timezone rõ, không chọn quá khứ/ngoài giờ.
- [ ] Alternative slot nếu giờ đã đầy.
- [ ] Price breakdown đầy đủ trước khi confirm.
- [ ] Review verified booking, rating breakdown, ảnh, host reply và report abuse.
- [ ] FAQ địa điểm.
- [ ] LocalBusiness/Breadcrumb/Review structured data chỉ từ dữ liệu thật.

## 8. Booking UX

### 8.1. Wizard 3 bước

```text
Bước 1: thời gian + room + add-ons
Bước 2: thông tin + ghi chú + policy + coupon
Bước 3: price summary + payment/xác nhận
```

- [ ] Guest giữ draft khi login và quay lại đúng bước.
- [ ] Không giữ slot vô hạn; temporary hold có expiry và countdown.
- [ ] Server là nguồn sự thật cho price, deposit, fee và availability.
- [ ] Chống double submit và retry idempotent.
- [ ] Instant booking và booking request là hai luồng rõ ràng.
- [ ] Có reschedule workflow, không giải phóng slot cũ trước khi giữ được slot mới.
- [ ] Cancellation hiển thị hạn miễn phí, số tiền hoàn và thời gian xử lý.
- [ ] Recurring booking P2: daily/weekly/by-day/until/count.
- [ ] Group booking: attendee, invitation, RSVP, calendar file.
- [ ] Add-ons có price, quantity, inventory, tax/refund policy.

### 8.2. Booking states đề xuất

```text
draft
hold
requested
awaiting_payment
payment_under_review
confirmed
in_use
completed
cancel_requested
cancelled
rejected
expired
reschedule_requested
disputed
```

## 9. Customer account

- [ ] Email/password, verify email, forgot/change password, logout all devices.
- [ ] Session/device list và security notification.
- [ ] Google OIDC P1, passkey/WebAuthn P1, TOTP 2FA và recovery codes.
- [ ] Profile: name, phone, avatar, company, invoice info, language, timezone, preferences.
- [ ] Dashboard: booking sắp tới, action required, payment pending, check-in QR.
- [ ] My bookings theo trạng thái và booking detail timeline.
- [ ] Calendar integration: ICS, Google, Outlook, Apple.
- [ ] QR check-in signed/short-lived, booking code fallback.
- [ ] Payment history, receipt, invoice, refund status, export.
- [ ] Notification center: in-app, email, push; SMS tùy chọn.
- [ ] Favorites và collection.
- [ ] Support ticket/chat theo booking, evidence, SLA.
- [ ] Download data, delete account, consent và marketing opt-out.

## 10. Host onboarding và verification

- [ ] Wizard: account → business → document → payout → first branch → preview → submit.
- [ ] Save draft và resume.
- [ ] Verification states: pending, needs_info, approved, rejected, suspended, revoked.
- [ ] Admin có reason, note, request-more-info và audit.
- [ ] Onboarding checklist có progress.
- [ ] Verification document lưu private, signed URL có expiry.
- [ ] Host chưa verify không truy cập host page/API.

## 11. Host branch/space management

- [ ] Branch: name, slug, address, coordinates, contact, hours, holiday hours, policies, SEO, publish status.
- [ ] Space: code, name, category, capacity, duration min/max, price, deposit, amenity, images, floor, status.
- [ ] Instant booking, advance window, buffer/cleanup time, calendar và add-ons.
- [ ] States: draft, pending_review, published, suspended, archived.
- [ ] Bulk edit price/status/hours/amenities/blackout.
- [ ] Calendar day/week/month/resource timeline.
- [ ] Maintenance và blackout có notification, replacement suggestion.
- [ ] External calendar iCal/Google/Microsoft P2.
- [ ] Media manager: upload progress, reorder, cover, crop, alt, thumbnails, orphan cleanup.

## 12. Host booking operations

- [ ] Booking inbox với new, awaiting payment, awaiting confirmation, today, in-use, ending soon, completed, cancelled, disputed.
- [ ] Action panel: confirm, reject, check-in/out, cancel, reschedule, message, payment, refund, internal note.
- [ ] Reception mode tối giản, scan QR, search code và danh sách hôm nay.
- [ ] No-show workflow và policy snapshot.
- [ ] Incident report: damage, late checkout, violation, evidence, internal/customer note.
- [ ] Không tự động phạt tiền khi chưa có policy và dispute flow.

## 13. Payment, refund, payout và finance

- [ ] Payment pending list có customer, booking, expected amount, submitted amount, reference, evidence, duplicate warning.
- [ ] Actions: verify, reject, request_more_information.
- [ ] Payment gateway dùng hosted checkout/tokenization; không lưu card/CVV.
- [ ] Webhook signature, replay protection, idempotency, retry và dead-letter queue.
- [ ] Refund state machine đầy đủ.
- [ ] Ledger append-only cho payment/refund/credit/payout.
- [ ] Host balance: pending, available, reserved, paid out.
- [ ] Payout schedule, bank verification, failure và reconciliation.
- [ ] Finance dashboard tách GMV, actual revenue, pending, refunded, outstanding, platform fee, host net.
- [ ] CSV/Excel/PDF export; export lớn chạy background.

### 13.1. Money invariants

```text
Money lưu integer minor unit + Currency.
Client không quyết định amount.
successfulPaid <= Booking.TotalAmount.
Refunded <= successfulPaid.
Payout <= available balance.
Mọi financial transition idempotent và audit được.
```

## 14. Pricing, coupon, membership

- [ ] Hourly, half-day, daily, weekly, monthly.
- [ ] Peak hour, weekend, holiday, last-minute, long-stay và corporate pricing.
- [ ] Rule priority và preview trước publish.
- [ ] Coupon percentage/fixed, min/max, time range, usage/user limit, branch/space scope.
- [ ] Platform-funded hoặc host-funded.
- [ ] Membership P2: credits, included hours, discount, priority booking.
- [ ] Credit ledger, expiry và không sửa balance trực tiếp.

## 15. Host staff và permission

Vai trò con: `owner`, `manager`, `receptionist`, `finance`, `content_editor`, `support`.

- [ ] Invite email có expiry, role và branch scope.
- [ ] Resend/revoke invite.
- [ ] Backend enforce permission, không chỉ ẩn button.
- [ ] Finance data không hiển thị cho receptionist.
- [ ] Owner-only staff management và payout settings.
- [ ] Audit role/permission change.

## 16. Messaging và realtime

- [ ] Conversation scope theo booking.
- [ ] Text, image/file giới hạn, read status, timestamp và system message.
- [ ] Không lộ email/phone nếu không cần.
- [ ] Report abuse và moderation access có audit.
- [ ] Socket rooms đúng scope: user, host, booking, admin.
- [ ] Không global broadcast.
- [ ] Notification preference và retry.

## 17. Admin

- [ ] Dashboard: user, host, listing, booking, payments, refunds, disputes, conversion, system health.
- [ ] User management: search, pagination, ban/unban, force logout, security events, deletion/export request.
- [ ] Host review: document, notes, request info, approve/reject/suspend/revoke.
- [ ] Listing moderation: quality, image, duplicate, misleading price, suspend/request change.
- [ ] Booking timeline, payment, dispute và manual resolution có reason/audit.
- [ ] Payment reconciliation, refund, duplicate, failed webhook và export.
- [ ] Dispute center: evidence, notes, decision, refund, appeal, SLA.
- [ ] Review moderation: reported, spam, abuse, restore và audit.
- [ ] CMS: homepage, FAQ, guide, city/category page, policy, announcement, versioning/schedule.
- [ ] SEO panel: title template, description, canonical, noindex, redirect, sitemap, schema preview.
- [ ] Feature flags: role, environment, percentage rollout, kill switch, audit.
- [ ] Audit log: actor, target, before/after, request ID, IP, UA, result; redact sensitive data.
- [ ] System health: latency, error, DB, queue, email, webhook, storage, job, deploy version.

## 18. SEO

- [ ] SSR-first cho title, heading, listing, address, price, hours, reviews và internal links.
- [ ] URL descriptive, lowercase, hyphen, slug stable và redirect history.
- [ ] Unique title/meta description/canonical/Open Graph/Twitter/favicons.
- [ ] Một H1, heading hierarchy đúng.
- [ ] Dynamic sitemap index: static, branches, spaces, cities, guides, images.
- [ ] Chỉ sitemap page published, canonical, indexable và 200.
- [ ] Robots disallow API/admin/private crawl nhưng không dùng robots để bảo vệ secret.
- [ ] Structured data: Organization, WebSite, LocalBusiness, BreadcrumbList, Article, Review/AggregateRating, FAQ khi hợp lệ.
- [ ] LocalBusiness có address, geo, telephone, image, hours, URL, price range.
- [ ] Không tạo rating/schema giả hoặc content không hiển thị.
- [ ] City/district/category pages phải có nội dung riêng, không thin pages.
- [ ] Filter crawl control, canonical/noindex phù hợp, normalize query order.
- [ ] Internal linking city→district→category→listing, guide→listing và breadcrumb.
- [ ] Google Search Console, sitemap, URL inspection, Core Web Vitals và rich result monitoring.
- [ ] Content people-first: hướng dẫn chọn phòng, tổ chức workshop, giá thuê, remote work, local guide.

### 18.1. URL mẫu

```text
/khong-gian
/khong-gian/ho-chi-minh
/khong-gian/ho-chi-minh/quan-1
/khong-gian/ho-chi-minh/quan-1/phong-hop
/khong-gian/ho-chi-minh/quan-1/workhub-nguyen-hue
/huong-dan/chon-phong-hop-quan-1
```

## 19. Performance

- [ ] Không dùng Tailwind CDN production; build, purge, minify, hash CSS.
- [ ] Route-specific JS; defer; không load Chart.js, Socket.IO hoặc Choices.js trên page không cần.
- [ ] Minify, tree-shake/code-split khi có build pipeline.
- [ ] Responsive AVIF/WebP, width/height, lazy load ngoài viewport, preload đúng LCP image.
- [ ] System/self-host WOFF2 font, subset tiếng Việt, font-display swap.
- [ ] Static hashed assets: `public, max-age=31536000, immutable`.
- [ ] Brotli tại CDN/reverse proxy, gzip fallback.
- [ ] CDN cho static/images và public cacheable content.
- [ ] Pagination, projection, `.lean()`, query indexes, tránh populate sâu và N+1.
- [ ] Search debounce, stale request cancellation và geo/facet index.
- [ ] Redis khi có use case thật: distributed rate limit, cache, queue, lock, idempotency.
- [ ] Background jobs cho email, push, image, export, sitemap, indexing, reminder, reconciliation.
- [ ] NODE_ENV production, reverse proxy, TLS, multi-instance, graceful shutdown.
- [ ] RUM thu LCP/INP/CLS/TTFB/FCP không PII.

### 19.1. Performance budget

```text
Initial compressed JS public page <= 150KB
Initial compressed CSS <= 60KB
Hero mobile image <= 150KB
Homepage initial transfer <= 800KB
Third-party JS <= 100KB
Không có unbounded DOM list
Không có sync I/O trong request hot path
```

### 19.2. Index gợi ý

```text
Branch: Status+CitySlug+DistrictSlug, HostID+Status, Slug unique
Space: BranchID+Status+Category, HostID+Status, BranchID+Capacity
Booking: CustomerID+createdAt, HostID+Status+StartTime, SpaceID+StartTime
Payment: HostID+Status+PaidAt, CustomerID+createdAt, BookingID+Status
Review: BranchID+createdAt, BookingID unique
Notification: UserID+IsRead+createdAt
```

## 20. Accessibility

- [ ] Skip link, keyboard navigation, focus visible, modal focus trap và return focus.
- [ ] Date/time picker và calendar dùng được bằng keyboard.
- [ ] Label thật, aria-describedby, error summary và autocomplete.
- [ ] Không disable paste password/OTP.
- [ ] Touch target đủ lớn và không quá sát.
- [ ] Contrast AA, focus contrast và status không chỉ dựa vào màu.
- [ ] Alt text, table header, accessible name và meaningful links.
- [ ] Respect reduced motion; không flash/autoplay audio.
- [ ] Passkey/password manager và accessible authentication.

## 21. Design system

Tạo token chung: color, spacing, radius, shadow, typography, breakpoint, z-index, motion.

- Button/IconButton/Link
- Input/Select/Combobox/Textarea
- DatePicker/TimeSlotPicker
- Checkbox/Radio/Switch
- FileUpload
- Card/ListingCard/BookingCard/PaymentCard
- Badge/Alert/Toast
- Modal/Drawer/Popover/Tooltip
- Tabs/Pagination/Breadcrumb
- Skeleton/EmptyState/ErrorState
- Table/DataTable
- Timeline/Stepper
- Gallery/Rating/PriceBreakdown

- [ ] Primary, secondary, tertiary, danger và link button hierarchy.
- [ ] Mỗi section tối đa một primary CTA.
- [ ] Responsive test 320, 360, 390, 430, 768, 1024, 1280, 1440.
- [ ] Skeleton cho list/card, spinner cho action nhỏ, không full-page spinner vô ích.
- [ ] Toast chỉ cho feedback ngắn; không dùng cho payment/legal/form error quan trọng.

## 22. PWA

- [ ] Manifest, icons và install prompt không gây phiền.
- [ ] Offline shell và cache assets.
- [ ] Offline lịch sử đã cache an toàn, không cache dữ liệu private tùy tiện.
- [ ] Push notification và app shortcuts.
- [ ] Không queue offline payment/booking theo cách gây duplicate.
- [ ] Service worker update UX rõ ràng.

## 23. Security

- [ ] ASVS 5.0 L2 checklist và threat model cho auth, booking, payment, upload, admin.
- [ ] Admin bắt buộc 2FA; host owner/finance khuyến nghị hoặc bắt buộc theo risk.
- [ ] Passkey/WebAuthn, session rotation, revoke, logout-all và device list.
- [ ] Distributed brute-force defense theo account+IP.
- [ ] Policy layer cho canViewBooking, canManageBranch, canVerifyPayment, canViewFinance.
- [ ] Signed/session-bound CSRF; Origin/Referer defense-in-depth.
- [ ] Safe DOM, escaped EJS, CSP nonce/hash, không unsafe-inline.
- [ ] Zod schema tập trung, reject unknown sensitive fields và mass-assignment allowlist.
- [ ] Upload kiểm magic bytes, size/count, re-encode image, virus scan document, private signed URLs.
- [ ] Payment tokenization, signed webhook, idempotency, ledger, reconciliation.
- [ ] Secrets manager, rotation, least privilege và không secret trong logs.
- [ ] TLS DB, network restriction, backup encryption, restore test.
- [ ] Structured logging và redaction password/OTP/cookie/auth/bank/document.
- [ ] HSTS, CSP, nosniff, Referrer-Policy, Permissions-Policy, frame protection.
- [ ] SAST, secret scan, dependency scan, SBOM và container scan nếu có.

## 24. Data architecture

- [ ] Money dùng integer minor unit + Currency, không float.
- [ ] Time lưu UTC; branch có IANA timezone; không hard-code `+07:00` trong business service.
- [ ] Booking snapshot lưu tên branch/space, address, price, policy, add-ons, tax, currency.
- [ ] Payment/refund/credit/payout dùng append-only ledger.
- [ ] Soft delete có chọn lọc; booking/payment/audit không xóa tùy tiện.
- [ ] Audit before/after diff có redaction.
- [ ] Mọi migration có dry-run, backup, index plan và idempotency.

## 25. Code architecture

```text
routes/
controllers/
validators/
policies/
services/
repositories/
models/
events/
jobs/
presenters/
views/
public/
tests/
```

- [ ] Controller chỉ parse request, gọi validator/service và trả response.
- [ ] Business workflow nằm trong service.
- [ ] Authorization nằm trong policy và query scope.
- [ ] Không trả nguyên Mongoose document; dùng DTO/presenter.
- [ ] Error taxonomy nhất quán.
- [ ] OpenAPI cho auth/search/booking/payment/host/admin.
- [ ] TypeScript chỉ migrate dần, không big-bang rewrite.
- [ ] Xóa deprecated routes sau sunset, field lowercase sau migration và dead code.

### 25.1. Error codes

```text
VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
CONFLICT
RATE_LIMITED
PAYMENT_REQUIRED
INTERNAL_ERROR
SERVICE_UNAVAILABLE
```

## 26. Tests

### Unit

- Pricing
- Slot
- State transition
- Permission
- Money
- Date/timezone
- Slug/SEO metadata

### Integration

- Auth
- CSRF
- Ownership
- Booking
- Payment
- Refund
- Verification
- Upload
- Admin
- Audit

### Concurrency

- Double booking
- Duplicate payment
- Concurrent verify/refund
- Coupon limit
- Slot release

### E2E

- Guest search→detail
- Customer booking→payment→history
- Host verify→confirm→check-in
- Admin verify host

### Accessibility

- axe
- Keyboard
- Focus
- Contrast
- Zoom/reflow

### Security

- XSS
- IDOR
- CSRF
- Mass assignment
- Upload
- Open redirect
- Cookie/session

### Performance

- Lighthouse CI
- Bundle budget
- Query benchmark
- Load test search/booking contention

### SEO

- Title
- Canonical
- Sitemap
- Robots
- Schema
- SSR
- 404/redirect
- Noindex private

## 27. Observability

- [ ] Product events: search, filter, listing view, availability, booking started/created, payment, confirm, complete, review.
- [ ] Funnel landing→search→detail→availability→booking→payment→confirmed→completed→review.
- [ ] Frontend/backend error monitoring.
- [ ] Request ID xuyên HTTP, DB, queue, email/payment provider.
- [ ] Alerts cho error spike, latency, payment/email/webhook failure, queue backlog, DB disconnect.
- [ ] Không gửi PII vào analytics/RUM.

## 28. Reliability và deployment

- [ ] `/health/live` và `/health/ready`.
- [ ] Graceful shutdown: HTTP, Socket.IO, worker, Mongo.
- [ ] Retry exponential backoff + jitter, max attempts, idempotency và dead-letter.
- [ ] Automated encrypted backup, retention và restore drill.
- [ ] Development/test/staging/production tách biệt.
- [ ] Pipeline: install→lint→test→scan→build→Lighthouse→staging→smoke→production→rollback.
- [ ] Feature flags cho rollout và kill switch.
- [ ] Migration backward-compatible và có rollback plan.

## 29. Roadmap

### Phase 0 — An toàn và đúng

- XSS admin/host
- Token legacy
- Admin page auth
- Revenue report
- Payment UI/concurrency
- Slot policy
- Strong CSRF/CSP
- CI xanh

### Phase 1 — Booking core

- Public IA
- Search/filter
- Listing detail
- Availability
- 3-step booking
- Timeline
- Notification
- Cancel/reschedule
- Mobile/design system
- SEO/performance baseline

### Phase 2 — Host operations

- Calendar
- Pricing
- Bulk edit
- Staff roles
- Reception/check-in
- Add-ons
- Finance/refund
- Messaging
- Listing quality

### Phase 3 — Growth

- Favorites
- Compare
- Coupon
- Membership
- Corporate booking
- Local SEO/CMS
- PWA/push
- External calendar
- Advanced search

### Phase 4 — Marketplace maturity

- Payment gateway
- Payout/ledger
- Dispute
- Fraud detection
- Advanced reporting
- Multi-language
- Enterprise account
- Partner API

## 30. Không nên làm quá sớm

- AI chatbot phức tạp.
- Dynamic pricing bằng ML.
- Blockchain.
- Native app riêng.
- VR/3D gallery nặng.
- Social feed.
- Gamification phức tạp.
- Microservices chỉ để trông chuyên nghiệp.
- Recommendation ML khi chưa đủ dữ liệu; dùng rule-based trước.

## 31. Definition of Done cho mỗi feature

- [ ] Có product requirement và user flow.
- [ ] Có responsive UI và accessibility.
- [ ] Có frontend/backend validation.
- [ ] Có auth/permission/ownership.
- [ ] Có data model, index và migration nếu cần.
- [ ] Có loading/empty/error/success state.
- [ ] Có audit cho action nhạy cảm.
- [ ] Có unit/integration/E2E cần thiết.
- [ ] Có security test.
- [ ] Có SEO check nếu public.
- [ ] Có performance/bundle check.
- [ ] Có analytics không PII.
- [ ] Có documentation.
- [ ] CI pass và không vượt budget không giải thích.

## 32. Quy tắc thực thi cho Grok/AI

- Không triển khai tất cả trong một commit.
- Tạo branch/PR theo phase và commit nhỏ có mục tiêu rõ.
- Không thay framework chỉ vì sở thích.
- Không chuyển microservices hoặc TypeScript big-bang.
- Không thêm Redis/dependency nếu chưa có use case.
- Không hạ security hoặc sửa fake test để CI xanh.
- Không hard-code timezone.
- Không dùng amount/status/identity từ client làm nguồn sự thật.
- Không innerHTML dữ liệu động.
- Không query list không pagination.
- Không tạo thin SEO pages.
- Không tuyên bố nhanh/an toàn nếu chưa đo/test.

## 33. Lệnh bắt đầu

```bash
npm ci
npm run lint
npm test
npm audit --audit-level=high
```

Sau baseline, tạo inventory: `existing`, `broken`, `missing`, `duplicate`, `deprecated`, `security risk`, `performance risk`, `SEO risk`, `UX risk`; sau đó triển khai Phase 0.

## 34. Báo cáo cuối mỗi phase

- Mục tiêu phase.
- Danh sách file thay đổi.
- Database/index/migration.
- API thay đổi.
- UX flow.
- Security impact.
- SEO impact.
- Performance impact.
- Accessibility.
- Kết quả lint/test/audit thật.
- Lighthouse và Core Web Vitals plan.
- Hạn chế còn lại.
- Next phase.

## 35. Nguồn tiêu chuẩn chính thức

- [Google Web Vitals](https://web.dev/articles/vitals)
- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Google LocalBusiness structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business)
- [Google Sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)
- [Google Breadcrumb structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
- [Google Review structured data](https://developers.google.com/search/docs/appearance/structured-data/review-snippet)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP API Security](https://owasp.org/API-Security/)
- [Express production performance](https://expressjs.com/en/advanced/best-practice-performance/)
- [Express production security](https://expressjs.com/en/advanced/best-practice-security/)
- [PWA](https://web.dev/learn/pwa/)
- [Passkeys](https://web.dev/articles/passkey-registration)
- [Schema.org LocalBusiness](https://schema.org/LocalBusiness)

## 36. Lệnh cuối cho AI

Hãy trực tiếp nâng cấp WorkHub theo tài liệu này, bắt đầu bằng Phase 0. Không nhồi tất cả tính năng vào giao diện. Mỗi tính năng phải giúp một persona hoàn thành một mục tiêu cụ thể.

```text
Sản phẩm cuối phải:
- Dễ dùng hơn
- Nhanh hơn
- Đẹp hơn
- An toàn hơn
- SEO tốt hơn
- Dễ bảo trì hơn
- Dễ mở rộng hơn
```
