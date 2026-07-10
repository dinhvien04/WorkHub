# WorkHub

Hệ thống đặt chỗ **Co-working Space** (Node.js · Express · EJS · MongoDB).

## Yêu cầu

- **Node.js** ≥ 18
- **MongoDB** 6+ (khuyến nghị **replica set** hoặc MongoDB Atlas nếu dùng multi-document transactions)
- Tài khoản Cloudinary (upload ảnh production)

## Cài đặt

```bash
git clone https://github.com/dinhvien04/WorkHub.git
cd WorkHub
cp .env.example .env
```

Sinh JWT secret an toàn:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Dán vào `JWT_SECRET` trong `.env`. **Không commit file `.env`.**

```bash
npm install
npm run dev
```

Mở http://localhost:3000

## Biến môi trường

| Biến | Bắt buộc | Mô tả |
|------|----------|--------|
| `JWT_SECRET` | Có | Secret ký JWT (≥ 32 ký tự) |
| `MONGODB_URI` | Có | Connection string MongoDB |
| `PORT` | Không | Mặc định `3000` |
| `NODE_ENV` | Không | `development` / `production` / `test` |
| `CLOUDINARY_*` | Production | Upload ảnh |
| `BOOKING_SLOT_MINUTES` | Không | Slot khóa lịch (mặc định 30) |
| `TRUST_PROXY` | Production | `true` khi sau reverse proxy |

Ứng dụng **fail-fast** nếu thiếu `JWT_SECRET` hoặc `MONGODB_URI`. Không có fallback secret.

## Scripts

```bash
npm run dev      # nodemon
npm start        # production
npm test         # jest + mongodb-memory-server
npm run lint     # eslint
npm run check    # lint + test
npm run seed:extras  # coupons + feature flags demo
```

## Product features (shipped baseline)

- 3-step booking wizard: `/booking/wizard`
- Favorites + guest merge: `/favorites`, `POST /api/me/favorites`
- Notifications center: `/notifications`
- Host calendar: `/host/calendar`, `GET /api/me/host/calendar`
- Coupons: `POST /api/me/coupons/preview` (seed `WELCOME10`, `FLAT20K`)
- Booking messages: `/api/me/bookings/:id/messages`
- ICS download: `/api/me/bookings/:id/ics`
- SEO URLs, sitemap, robots, PWA manifest + service worker
- Payment verify/reject UI for host
- Search API `/api/search`, autocomplete
- Reschedule, refunds, disputes, ledger, staff invites
- Host reception / staff / finance pages
- CMS guides `/huong-dan/:slug`, compare, support tickets
- OpenAPI: `docs/openapi.yaml`
- Mock payment gateway + signed webhook (`POST /api/gateway/webhook`)
- Host payouts + ledger reserve (`/host/finance`, `POST /api/host/payouts`)
- Membership subscribe, recurring series, group/corporate booking
- Partner API keys (`/api/partner/v1/*` + `X-API-Key`)
- Fraud rule score, i18n vi/en, device sessions + logout-all
- Privacy export / delete request (`/security`, `/api/me/privacy/*`)
- RUM web-vitals beacon (`POST /api/rum`)
- Host iCal feed, dead-letter queue, backup script
- TOTP 2FA + recovery codes (`/security`, `/api/auth/2fa/*`)
- Signed QR check-in + booking code + no-show
- Blackout blocks booking; pricing rules applied server-side
- Feature flags (percentage/role/env) + admin upsert
- SEO: sitemap index, cities/guides sitemaps, redirects, rich LocalBusiness JSON-LD
- Notification prefs + admin system-health
- Booking add-ons, instant book, conflict alternatives, price breakdown
- Receipt HTML + host ledger CSV export
- Email verification request/confirm
- Review report / moderate / host reply
- Admin SEO redirects, flags, health UIs
- Perf: Chart.js / Choices / Socket only when needed
- Cancellation policy snapshot + cancel preview / timeline
- Host inbox buckets + onboarding checklist
- Upload magic-bytes validation, booking DTO presenter
- Admin force-logout, hold-expiry reminder job
- Space buffer/cleanup + free-cancel hours ops API
- Host payment verify gated by `payment:verify` permission
- Booking detail page (timeline, cancel, Google/Outlook/ICS)
- Host internal notes; consent/privacy page; modal focus trap
- OpenAPI 1.4.0
- Geo search (`lat`/`lng`/`radiusKm`/`sort=near`) + zero-result tips
- Staff act-as-host context (`X-Host-Owner-Id`, `/api/staff/*`)
- Admin optional 2FA gate (flag `admin_require_2fa` or `ADMIN_REQUIRE_2FA=1`)
- SBOM: `npm run sbom` → `docs/sbom.json`; `npm run audit:prod`
- FAQPage JSON-LD for CMS guides with `Q:`/`A:` lines
- Listing map (OpenStreetMap embed) + gallery width/height for CLS
- Passkey/WebAuthn register+login challenge flow (`/api/auth/webauthn/*`)
- Web Push subscribe API + SW `push` handler (VAPID optional)
- Staff reception/check-in proxy (`/api/staff/host/*`)
- Socket `join_booking` scoped rooms; critical self-hosted CSS utilities
- Google OIDC (`/api/auth/google` + callback; mock in test via `ALLOW_GOOGLE_MOCK`)
- Staff calendar proxy; payment hold countdown UI
- Multi-provider gateway mocks: `workhub_mock` / `stripe_mock` / `momo_mock`
- Staff confirm + no-show; search filters URL state + near-me
- Upload content scan (magic + polyglot heuristic); optional `web-push` send

```bash
npm run backup
npm run sbom
```

## Roles

| Role | Quyền |
|------|--------|
| `customer` | Đặt chỗ, thanh toán, review, hồ sơ cá nhân |
| `host` | Quản lý branch/space, duyệt booking, xem payment của mình |
| `admin` | User, host verification, audit log |

## Booking states

```
pending → confirmed → in-use → completed
   ↘ cancelled ↗
```

Transition chỉ qua `services/bookingService.js`.  
Job `jobs/completeExpiredBookings.js` chỉ chuyển `in-use` + `EndTime < now` → `completed`.

Slot lock: floor-start intervals (`BOOKING_SLOT_MINUTES`), unique index `{ SpaceID, SlotStart }`.  
Giới hạn: `MAX_BOOKING_HOURS`, `MAX_BOOKING_DAYS_AHEAD`.

## Payment states

`pending` · `successful` · `failed` · `refunded` · `refund_pending`

**Chỉ** `Status = successful` được tính là đã thanh toán.

## Auth model

- JWT trong cookie **HttpOnly** `authToken`
- Không lưu JWT trong `localStorage`
- `GET /api/auth/me` cho trạng thái đăng nhập
- `POST /api/auth/logout` xóa cookie
- `tokenVersion` vô hiệu hóa token sau ban / đổi mật khẩu
- CSRF double-submit (`csrfToken` cookie + header `X-CSRF-Token`)
- Rate limit: login, register, forgot/reset password, booking, payment

## API chính

```
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/forgot-password
POST   /api/auth/reset-password

GET    /api/customers/me/profile
PUT    /api/customers/me/profile
GET    /api/customers/me/bookings
GET    /api/customers/bookings/availability   (public GET, no CSRF)
POST   /api/customers/me/bookings
PUT    /api/customers/me/bookings/:bookingId/cancel
POST   /api/customers/me/booking/confirm      (requires Idempotency-Key)

GET    /api/hosts/branches
GET    /api/hosts/bookings
PUT    /api/hosts/bookings/:id/confirm|checkin|cancel
PUT    /api/hosts/payments/:paymentId/verify|reject

GET    /health
```

Customer **API chỉ** mount tại `/api/customers`. Page routes tại `/`.  
Route `/:userId/...` deprecated, self-only, chỉ dưới `/api/customers`.

Host mới: `Status=inactive` + `IsVerified=false` cho đến khi admin verify.

## Security notes

- Production bắt buộc HTTPS
- Rotate `JWT_SECRET` nếu bị lộ
- Không commit secrets
- Ownership check trên mọi object theo ID
- Upload: JPEG/PNG/WebP (PDF chỉ verification document), max 5MB
- Helmet + CSP + body limit 1mb

## Deploy production

1. Set `NODE_ENV=production`, HTTPS reverse proxy, `TRUST_PROXY=true`
2. MongoDB Atlas / replica set
3. Cloudinary credentials
4. `npm ci && npm start`
5. Process manager: pm2 / systemd

## Kiến trúc thư mục

```
app.js                 # Express app (no listen)
server.js              # HTTP + Socket.IO + graceful shutdown
config/env.js          # Env validation
services/              # Booking, payment, socket, email
jobs/                  # Background jobs
middlewares/           # Auth, CSRF, rate limit, upload, errors
test/                  # Integration & unit tests
```
