# WORKHUB MASTER PRODUCT & IMPLEMENTATION PROMPT

**Mục tiêu:** nâng cấp WorkHub thành nền tảng đặt chỗ co-working space dễ dùng nhất có thể, giao diện đẹp, tải cực nhanh, SEO tốt, bảo mật cao, code dễ bảo trì và sẵn sàng mở rộng.

**Repository:** `https://github.com/dinhvien04/WorkHub`  
**Baseline review:** commit `1f8b0a3580cea5272dde335ae56c7e89dfaead8a`

> Tài liệu này vừa là đặc tả sản phẩm, vừa là prompt thực thi cho Grok/AI. Không triển khai tất cả trong một commit; phải làm theo phase, có test, migration, đo hiệu năng và báo cáo thật.

## Checklist progress (repo)

> **Cập nhật checklist:** 2026-07-10 · main verification/publish batch
> **Quy ước:** `[x]` = đã ship baseline trong code (+ test liên quan). Ghi `*(partial: …)*` nếu đặc tả đầy đủ chưa xong. `[ ]` = chưa làm hoặc còn thiếu lõi.  
> **Bắt buộc:** mỗi batch ship xong phải tick/cập nhật partial trong file này cùng commit (hoặc commit ngay sau).


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

- [x] Xóa stored XSS còn lại trong `admin-main.js`, `host-dashboard.js`, `host-spaces.js`. *(baseline DomSafe + tests; rà soát `host-spaces.js` còn lớn)*
- [x] Thay renderer có dữ liệu user bằng `createElement`, `textContent`, `replaceChildren`, `addEventListener`.
- [x] Loại bỏ inline onclick, onerror, onchange với dữ liệu động. *(baseline: không gắn handler với user HTML; một số onclick tĩnh còn lại)*
- [x] Xóa biến `token` legacy và mọi `Bearer ${token}` ở frontend.
- [x] Bảo vệ toàn bộ admin page bằng page middleware, không chỉ bảo vệ API.
- [x] Xóa route admin khai báo trùng.
- [x] Sửa host report: actual revenue chỉ từ payment `successful`.
- [x] Sửa host dashboard dùng đúng `pendingAmount`, `refundedAmount`.
- [x] Nối UI verify/reject payment vào API hiện có.
- [x] Customer phải thấy 'đang chờ xác minh', không thấy 'thanh toán thành công' khi payment còn pending.
- [x] QR/payment summary phải lấy `TotalAmount` và `DepositAmount` từ booking server response.
- [x] Sửa payment verify concurrency để invariant `successfulPaid <= TotalAmount` luôn đúng.
- [x] Chọn chính sách slot boundary rõ ràng và validate cả frontend/backend.
- [x] Nâng CSRF thành signed/session-bound token hoặc synchronizer token. *(synchronizer cookie CSRF đã ship; signed session-bound vẫn optional)*
- [x] Loại `'unsafe-inline'` khỏi CSP bằng nonce/hash và external event listeners. *(script-src nonce; style-src vẫn cần `unsafe-inline` cho Tailwind CDN)*
- [x] CI phải có workflow run thật và fail khi lint/test/high-severity audit fail. *(partial: Jest/lint CI; audit high gate có thể chưa fail-hard mọi job)*

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

- [x] URL slug thân thiện, không public URL chỉ có ObjectId.
- [x] Above-the-fold có tên, khu vực, rating, giá từ, ảnh, availability CTA và chính sách ngắn.
- [x] Gallery AVIF/WebP, srcset, dimension cố định, lightbox, keyboard, swipe và lazy load.
- [x] Mô tả, tiện nghi, capacity, loại phòng, giờ mở cửa, chính sách, parking, accessibility. *(partial: parking/a11y fields UI mỏng)*
- [x] Map, hướng dẫn đi lại, landmark, thông tin host.
- [x] Availability calendar realtime, timezone rõ, không chọn quá khứ/ngoài giờ. *(partial: slot cố định + API; full calendar picker chưa)*
- [x] Alternative slot nếu giờ đã đầy.
- [x] Price breakdown đầy đủ trước khi confirm.
- [x] Review verified booking, rating breakdown, ảnh, host reply và report abuse. *(partial: chưa upload ảnh review)*
- [x] FAQ địa điểm.
- [x] LocalBusiness/Breadcrumb/Review structured data chỉ từ dữ liệu thật.

## 8. Booking UX

### 8.1. Wizard 3 bước

```text
Bước 1: thời gian + room + add-ons
Bước 2: thông tin + ghi chú + policy + coupon
Bước 3: price summary + payment/xác nhận
```

- [x] Guest giữ draft khi login và quay lại đúng bước.
- [x] Không giữ slot vô hạn; temporary hold có expiry và countdown.
- [x] Server là nguồn sự thật cho price, deposit, fee và availability.
- [x] Chống double submit và retry idempotent.
- [x] Instant booking và booking request là hai luồng rõ ràng. *(partial: InstantBook flag + copy; UI 2 flow chưa tách hẳn)*
- [x] Có reschedule workflow, không giải phóng slot cũ trước khi giữ được slot mới.
- [x] Cancellation hiển thị hạn miễn phí, số tiền hoàn và thời gian xử lý.
- [x] Recurring booking P2: daily/weekly/by-day/until/count.
- [x] Group booking: attendee, invitation, RSVP, calendar file.
- [x] Add-ons có price, quantity, inventory, tax/refund policy.

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

- [x] Email/password, verify email, forgot/change password, logout all devices.
- [x] Session/device list và security notification.
- [x] Google OIDC P1, passkey/WebAuthn P1, TOTP 2FA và recovery codes.
- [x] Profile: name, phone, avatar, company, invoice info, language, timezone, preferences. *(partial: name/phone/avatar + lang/tz prefs; invoice company mỏng)*
- [x] Dashboard: booking sắp tới, action required, payment pending, check-in QR.
- [x] My bookings theo trạng thái và booking detail timeline.
- [x] Calendar integration: ICS, Google, Outlook, Apple.
- [x] QR check-in signed/short-lived, booking code fallback.
- [x] Payment history, receipt, invoice, refund status, export. *(receipt HTML + history; invoice PDF formal chưa)*
- [x] Notification center: in-app, email, push; SMS tùy chọn.
- [x] Favorites và collection. *(favorites + merge; collection/folder chưa)*
- [x] Support ticket/chat theo booking, evidence, SLA. *(ticket/chat; evidence/SLA mỏng)*
- [x] Download data, delete account, consent và marketing opt-out.

## 10. Host onboarding và verification

- [x] Wizard: account → business → document → payout → first branch → preview → submit. *(partial: onboarding checklist + profile/spaces; wizard multi-step full chưa)*
- [x] Save draft và resume. *(partial: onboarding/profile draft; wizard full resume mỏng)*
- [x] Verification states: pending, needs_info, approved, rejected, suspended, revoked. *(API `PATCH /api/admin/hosts/:id/verification` + IsVerified sync)*
- [x] Admin có reason, note, request-more-info và audit. *(partial: verify + moderation reason; needs_info flow mỏng)*
- [x] Onboarding checklist có progress.
- [x] Verification document lưu private, signed URL có expiry. *(signed access token + redeem; blob store private thật tùy Cloudinary)*
- [x] Host chưa verify không truy cập host page/API.

## 11. Host branch/space management

- [x] Branch: name, slug, address, coordinates, contact, hours, holiday hours, policies, SEO, publish status. *(partial: core fields + slug/geo; holiday hours mỏng)*
- [x] Space: code, name, category, capacity, duration min/max, price, deposit, amenity, images, floor, status. *(partial: core; duration min/max + floor mỏng)*
- [x] Instant booking, advance window, buffer/cleanup time, calendar và add-ons. *(partial: instant + buffer/cleanup + calendar + add-ons)*
- [x] States: draft, pending_review, published, suspended, archived. *(PublishStatus trên Branch; space lifecycle mỏng)*
- [x] Bulk edit price/status/hours/amenities/blackout.
- [x] Calendar day/week/month/resource timeline. *(partial: host calendar; resource timeline đầy đủ chưa)*
- [x] Maintenance và blackout có notification, replacement suggestion.
- [ ] External calendar iCal/Google/Microsoft P2.
- [x] Media manager: upload progress, reorder, cover, crop, alt, thumbnails, orphan cleanup. *(partial: upload + reorder/delete; crop/alt/orphan chưa)*

## 12. Host booking operations

- [x] Booking inbox với new, awaiting payment, awaiting confirmation, today, in-use, ending soon, completed, cancelled, disputed.
- [x] Action panel: confirm, reject, check-in/out, cancel, reschedule, message, payment, refund, internal note. *(partial: rải nhiều page; panel gộp chưa)*
- [x] Reception mode tối giản, scan QR, search code và danh sách hôm nay.
- [x] No-show workflow và policy snapshot.
- [x] Incident report: damage, late checkout, violation, evidence, internal/customer note. *(partial: Incident model/API; evidence file mỏng)*
- [x] Không tự động phạt tiền khi chưa có policy và dispute flow.

## 13. Payment, refund, payout và finance

- [x] Payment pending list có customer, booking, expected amount, submitted amount, reference, evidence, duplicate warning. *(partial: verify UI + idempotency; evidence upload mỏng)*
- [x] Actions: verify, reject, request_more_information.
- [x] Payment gateway dùng hosted checkout/tokenization; không lưu card/CVV.
- [x] Webhook signature, replay protection, idempotency, retry và dead-letter queue.
- [x] Refund state machine đầy đủ.
- [x] Ledger append-only cho payment/refund/credit/payout.
- [x] Host balance: pending, available, reserved, paid out.
- [x] Payout schedule, bank verification, failure và reconciliation. *(partial: payout request + bank on profile; schedule/recon mỏng)*
- [x] Finance dashboard tách GMV, actual revenue, pending, refunded, outstanding, platform fee, host net. *(partial: balance/ledger/revenue metrics; fee platform mỏng)*
- [x] CSV/Excel/PDF export; export lớn chạy background.

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
- [x] Peak hour, weekend, holiday, last-minute, long-stay và corporate pricing. *(partial: PricingRule peak/weekend; holiday/corporate mỏng)*
- [ ] Rule priority và preview trước publish.
- [x] Coupon percentage/fixed, min/max, time range, usage/user limit, branch/space scope.
- [x] Platform-funded hoặc host-funded.
- [x] Membership P2: credits, included hours, discount, priority booking. *(partial: plans/subscribe; credit ledger mỏng)*
- [ ] Credit ledger, expiry và không sửa balance trực tiếp.

## 15. Host staff và permission

Vai trò con: `owner`, `manager`, `receptionist`, `finance`, `content_editor`, `support`.

- [x] Invite email có expiry, role và branch scope.
- [x] Resend/revoke invite.
- [x] Backend enforce permission, không chỉ ẩn button.
- [x] Finance data không hiển thị cho receptionist.
- [x] Owner-only staff management và payout settings.
- [x] Audit role/permission change. *(partial: audit log chung; diff role-change chuyên biệt mỏng)*

## 16. Messaging và realtime

- [x] Conversation scope theo booking.
- [x] Text, image/file giới hạn, read status, timestamp và system message. *(partial: text + timestamp; image/read status mỏng)*
- [x] Không lộ email/phone nếu không cần. *(redact email/phone trong messages)*
- [x] Report abuse và moderation access có audit. *(report message + audit; admin queue chuyên biệt mỏng)*
- [x] Socket rooms đúng scope: user, host, booking, admin.
- [x] Không global broadcast.
- [x] Notification preference và retry.

## 17. Admin

- [x] Dashboard: user, host, listing, booking, payments, refunds, disputes, conversion, system health. *(partial: admin dashboard + conversion metrics + health)*
- [x] User management: search, pagination, ban/unban, force logout, security events, deletion/export request. *(partial: list/toggle/force-logout; security events UI mỏng)*
- [x] Host review: document, notes, request info, approve/reject/suspend/revoke. *(partial: verify host; needs_info/revoke đầy đủ chưa)*
- [x] Listing moderation: quality, image, duplicate, misleading price, suspend/request change.
- [x] Booking timeline, payment, dispute và manual resolution có reason/audit. *(partial: timeline + dispute center baseline)*
- [ ] Payment reconciliation, refund, duplicate, failed webhook và export.
- [x] Dispute center: evidence, notes, decision, refund, appeal, SLA. *(partial: open/list/resolve; appeal/SLA mỏng)*
- [x] Review moderation: reported, spam, abuse, restore và audit.
- [x] CMS: homepage, FAQ, guide, city/category page, policy, announcement, versioning/schedule. *(partial: guide CMS; versioning/schedule chưa)*
- [x] SEO panel: title template, description, canonical, noindex, redirect, sitemap, schema preview. *(partial: redirects + sitemap links; template/schema preview mỏng)*
- [x] Feature flags: role, environment, percentage rollout, kill switch, audit.
- [x] Audit log: actor, target, before/after, request ID, IP, UA, result; redact sensitive data.
- [x] System health: latency, error, DB, queue, email, webhook, storage, job, deploy version.

## 18. SEO

- [x] SSR-first cho title, heading, listing, address, price, hours, reviews và internal links.
- [x] URL descriptive, lowercase, hyphen, slug stable và redirect history.
- [x] Unique title/meta description/canonical/Open Graph/Twitter/favicons.
- [x] Một H1, heading hierarchy đúng.
- [x] Dynamic sitemap index: static, branches, spaces, cities, guides, images.
- [x] Chỉ sitemap page published, canonical, indexable và 200.
- [x] Robots disallow API/admin/private crawl nhưng không dùng robots để bảo vệ secret.
- [x] Structured data: Organization, WebSite, LocalBusiness, BreadcrumbList, Article, Review/AggregateRating, FAQ khi hợp lệ.
- [x] LocalBusiness có address, geo, telephone, image, hours, URL, price range.
- [x] Không tạo rating/schema giả hoặc content không hiển thị.
- [x] City/district/category pages phải có nội dung riêng, không thin pages.
- [x] Filter crawl control, canonical/noindex phù hợp, normalize query order. *(partial: robots + canonical; filter noindex đầy đủ chưa)*
- [x] Internal linking city→district→category→listing, guide→listing và breadcrumb.
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

- [x] Không dùng Tailwind CDN production; build, purge, minify, hash CSS. *(purge/minify; hash filename 1y immutable chưa)*
- [x] Route-specific JS; defer; không load Chart.js, Socket.IO hoặc Choices.js trên page không cần.
- [ ] Minify, tree-shake/code-split khi có build pipeline.
- [x] Responsive AVIF/WebP, width/height, lazy load ngoài viewport, preload đúng LCP image.
- [ ] System/self-host WOFF2 font, subset tiếng Việt, font-display swap.
- [ ] Static hashed assets: `public, max-age=31536000, immutable`.
- [ ] Brotli tại CDN/reverse proxy, gzip fallback.
- [ ] CDN cho static/images và public cacheable content.
- [x] Pagination, projection, `.lean()`, query indexes, tránh populate sâu và N+1.
- [x] Search debounce, stale request cancellation và geo/facet index.
- [x] Redis khi có use case thật: distributed rate limit, cache, queue, lock, idempotency.
- [x] Background jobs cho email, push, image, export, sitemap, indexing, reminder, reconciliation.
- [x] NODE_ENV production, reverse proxy, TLS, multi-instance, graceful shutdown. *(partial: production config/docker; multi-instance hardened chưa)*
- [x] RUM thu LCP/INP/CLS/TTFB/FCP không PII.

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

- [x] Skip link, keyboard navigation, focus visible, modal focus trap và return focus.
- [ ] Date/time picker và calendar dùng được bằng keyboard.
- [ ] Label thật, aria-describedby, error summary và autocomplete.
- [x] Không disable paste password/OTP.
- [ ] Touch target đủ lớn và không quá sát.
- [ ] Contrast AA, focus contrast và status không chỉ dựa vào màu.
- [ ] Alt text, table header, accessible name và meaningful links.
- [x] Respect reduced motion; không flash/autoplay audio.
- [x] Passkey/password manager và accessible authentication.

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

- [x] Primary, secondary, tertiary, danger và link button hierarchy.
- [x] Mỗi section tối đa một primary CTA.
- [ ] Responsive test 320, 360, 390, 430, 768, 1024, 1280, 1440.
- [x] Skeleton cho list/card, spinner cho action nhỏ, không full-page spinner vô ích.
- [ ] Toast chỉ cho feedback ngắn; không dùng cho payment/legal/form error quan trọng.

## 22. PWA

- [x] Manifest, icons và install prompt không gây phiền.
- [x] Offline shell và cache assets.
- [x] Offline lịch sử đã cache an toàn, không cache dữ liệu private tùy tiện.
- [x] Push notification và app shortcuts.
- [x] Không queue offline payment/booking theo cách gây duplicate.
- [x] Service worker update UX rõ ràng.

## 23. Security

- [ ] ASVS 5.0 L2 checklist và threat model cho auth, booking, payment, upload, admin.
- [x] Admin bắt buộc 2FA; host owner/finance khuyến nghị hoặc bắt buộc theo risk.
- [x] Passkey/WebAuthn, session rotation, revoke, logout-all và device list.
- [x] Distributed brute-force defense theo account+IP. *(partial: rate limit; account lockout mỏng)*
- [x] Policy layer cho canViewBooking, canManageBranch, canVerifyPayment, canViewFinance.
- [x] Signed/session-bound CSRF; Origin/Referer defense-in-depth. *(partial: synchronizer CSRF)*
- [x] Safe DOM, escaped EJS, CSP nonce/hash, không unsafe-inline.
- [x] Zod schema tập trung, reject unknown sensitive fields và mass-assignment allowlist.
- [x] Upload kiểm magic bytes, size/count, re-encode image, virus scan document, private signed URLs. *(partial: magic + scan optional; re-encode/signed private URL mỏng)*
- [x] Payment tokenization, signed webhook, idempotency, ledger, reconciliation.
- [ ] Secrets manager, rotation, least privilege và không secret trong logs.
- [ ] TLS DB, network restriction, backup encryption, restore test.
- [x] Structured logging và redaction password/OTP/cookie/auth/bank/document.
- [x] HSTS, CSP, nosniff, Referrer-Policy, Permissions-Policy, frame protection.
- [x] SAST, secret scan, dependency scan, SBOM và container scan nếu có.

## 24. Data architecture

- [ ] Money dùng integer minor unit + Currency, không float.
- [x] Time lưu UTC; branch có IANA timezone; không hard-code `+07:00` trong business service.
- [x] Booking snapshot lưu tên branch/space, address, price, policy, add-ons, tax, currency.
- [x] Payment/refund/credit/payout dùng append-only ledger.
- [x] Soft delete có chọn lọc; booking/payment/audit không xóa tùy tiện.
- [ ] Audit before/after diff có redaction.
- [x] Mọi migration có dry-run, backup, index plan và idempotency.

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

- [x] Controller chỉ parse request, gọi validator/service và trả response.
- [x] Business workflow nằm trong service.
- [x] Authorization nằm trong policy và query scope.
- [x] Không trả nguyên Mongoose document; dùng DTO/presenter. *(partial: bookingPresenter + nhiều API; chưa 100% endpoints)*
- [x] Error taxonomy nhất quán.
- [x] OpenAPI cho auth/search/booking/payment/host/admin.
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

- [x] Product events: search, filter, listing view, availability, booking started/created, payment, confirm, complete, review. *(partial: metrics counters + RUM; full product analytics mỏng)*
- [ ] Funnel landing→search→detail→availability→booking→payment→confirmed→completed→review.
- [ ] Frontend/backend error monitoring.
- [x] Request ID xuyên HTTP, DB, queue, email/payment provider.
- [ ] Alerts cho error spike, latency, payment/email/webhook failure, queue backlog, DB disconnect.
- [x] Không gửi PII vào analytics/RUM.

## 28. Reliability và deployment

- [x] `/health/live` và `/health/ready`.
- [x] Graceful shutdown: HTTP, Socket.IO, worker, Mongo.
- [x] Retry exponential backoff + jitter, max attempts, idempotency và dead-letter.
- [x] Automated encrypted backup, retention và restore drill. *(partial: backup script; encrypted restore drill chưa)*
- [ ] Development/test/staging/production tách biệt.
- [ ] Pipeline: install→lint→test→scan→build→Lighthouse→staging→smoke→production→rollback.
- [x] Feature flags cho rollout và kill switch.
- [ ] Migration backward-compatible và có rollback plan.

## 29. Roadmap

### Phase status (auto)

- **Phase 0:** gần xong baseline (XSS/CSRF/CSP/payment/CI còn partial ở audit gate & host-spaces rà soát).
- **Phase 1:** booking core baseline đã ship (search, detail, wizard, cancel/reschedule, SEO/PWA).
- **Phase 2:** host ops baseline đã ship (calendar, bulk, staff, reception, finance, messaging).
- **Phase 3:** growth baseline đã ship (favorites, compare, coupon, membership skeleton, CMS, PWA/push).
- **Còn lại:** độ sâu UX, media crop/alt, listing states draft/publish, membership credits, a11y audit formal, perf hash assets/font self-host, Playwright CI bắt buộc.


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

- [x] Có product requirement và user flow. *(file master + ship theo phase)*
- [x] Có responsive UI và accessibility. *(partial: mobile-first + skip/focus; WCAG audit formal chưa)*
- [x] Có frontend/backend validation.
- [x] Có auth/permission/ownership.
- [x] Có data model, index và migration nếu cần.
- [x] Có loading/empty/error/success state. *(partial: nhiều màn; chưa đồng đều mọi section)*
- [x] Có audit cho action nhạy cảm.
- [x] Có unit/integration/E2E cần thiết. *(Jest rộng; Playwright skip-safe, chưa bắt buộc CI)*
- [x] Có security test. *(XSS/CSRF/IDOR/upload tests baseline)*
- [x] Có SEO check nếu public. *(sitemap/schema tests; GSC ngoài code)*
- [x] Có performance/bundle check. *(partial: purge CSS + RUM; Lighthouse CI chưa)*
- [x] Có analytics không PII. *(RUM beacon; product funnel analytics mỏng)*
- [x] Có documentation. *(README + OpenAPI)*
- [x] CI pass và không vượt budget không giải thích. *(partial: test pass local/CI; budget gate mỏng)*

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
