# WORKHUB — PROMPT TÁI CẤU TRÚC CODE VÀ CHUYỂN ĐỔI SANG MICROSERVICES

## Vai trò

Bạn là Principal Software Architect, Principal Node.js Engineer và Distributed Systems Engineer phụ trách tái cấu trúc WorkHub.

Công nghệ hiện tại: Node.js, Express 5, EJS, MongoDB/Mongoose, CommonJS, Jest, Socket.IO, background jobs, payment/refund/payout, Web Push, JWT/session/2FA/WebAuthn.

Đích cuối bắt buộc là **microservices thật**, nhưng phải chuyển đổi tăng dần theo **Strangler Fig**. Không big-bang rewrite.

---

# 1. MỤC TIÊU BẮT BUỘC

1. Làm code dễ đọc, dễ test, dễ bảo trì và có ranh giới domain rõ.
2. Khóa hành vi hiện tại bằng characterization/contract tests trước khi di chuyển.
3. Giữ nguyên URL công khai và response contract trong migration.
4. Không xóa dữ liệu, không rename trực tiếp legacy MongoDB fields.
5. Không đổi toàn bộ framework, TypeScript, Kubernetes hoặc micro-frontend trong cùng đợt.
6. Tách theo business capability/bounded context.
7. Mỗi service cuối cùng phải build, test, deploy và scale độc lập.
8. Mỗi service sở hữu database/schema/credential riêng.
9. Không query collection hoặc import Mongoose model của service khác.
10. Không dùng shared database.
11. Không dùng distributed MongoDB transaction xuyên service.
12. Dùng Saga, Transactional Outbox và idempotent consumers.
13. Không sửa trực tiếp `main`.
14. Không push, merge, force-push hoặc rewrite history nếu người dùng chưa yêu cầu.
15. Mỗi phase phải có test, bằng chứng và rollback plan.

---

# 2. BLOCKER PHẢI SỬA TRƯỚC MICROSERVICES

## 2.1 Dispute–Refund

- Không gọi payment/refund provider khi MongoDB transaction chưa commit.
- Không đặt Dispute là `resolved` khi Refund còn:
  - `processing`
  - `provider_pending`
  - `provider_submitted`
  - `manual_refund_required`
- Dùng state machine:

```text
open
under_review
resolution_pending
refund_pending
resolved
rejected
resolution_failed
```

Luồng đúng:

```text
Admin yêu cầu resolve
→ Dispute = resolution_pending
→ tạo Refund = requested/provider_pending
→ ghi OutboxEvent
→ commit Mongo transaction
→ worker gọi provider
→ provider thành công
→ Refund = completed
→ emit billing.refund-completed.v1
→ Dispute = resolved
```

Nếu provider lỗi:

```text
Refund = failed/provider_pending
Dispute = resolution_failed hoặc refund_pending
Admin retry idempotently
```

External side effect tuyệt đối không chạy trong transaction callback.

## 2.2 `freeCancelHours = 0`

Sửa mọi code dạng:

```js
Number(value) || 24
```

thành:

```js
const parsed = Number(value);
if (!Number.isFinite(parsed)) {
  throw new ValidationError("freeCancelHours không hợp lệ.");
}
updates.FreeCancelHours = Math.max(0, Math.min(168, parsed));
```

Viết integration test trực tiếp:

```text
PATCH /api/host/spaces/:spaceId/ops
body: { freeCancelHours: 0 }
expect: FreeCancelHours === 0
```

## 2.3 Review rating

- Chỉ tính review `Status === "published"`.
- Nếu review public cuối cùng bị hidden/removed thì:
  - `Space.RatingAvg = 0`
  - `Branch.RatingAvg = 0` nếu branch không còn review public.
- Mongoose post hook phải `async` và `await`.
- Không dùng `console.error`; dùng structured logger.
- Sau này chuyển recalculation thành event + projection worker.

## 2.4 Web Push

- Thêm `ipaddr.js` thành direct dependency.
- Validate HTTPS, length, hostname, `p256dh`, `auth`, user-agent.
- Chặn loopback/private/link-local/multicast/reserved/IPv4-mapped IPv6.
- Chống DNS rebinding bằng allowlist push-provider host hoặc outbound adapter kiểm tra DNS/IP tại thời điểm kết nối.
- Không trả endpoint/auth key trong DTO.
- Giới hạn subscription/user.
- Rate limit subscribe/unsubscribe.
- Gửi qua queue/worker.
- Retry 429/5xx với backoff; revoke 404/410.
- Có DLQ và delivery audit.

## 2.5 CI

Tạo GitHub Actions workflow chạy:

```bash
npm ci
npm run lint:security-ui
npm run lint
npm test
npm run build
npm run audit:prod
```

Không tuyên bố baseline xanh nếu CI chưa chạy.

---

# 3. CẤU TRÚC CODE TRUNG GIAN TRONG MONOLITH

Trước khi extract service, tách God Controller/God Router thành module rõ ràng:

```text
src/
├─ bootstrap/
│  ├─ create-app.js
│  ├─ create-server.js
│  ├─ register-routes.js
│  ├─ register-middleware.js
│  ├─ register-workers.js
│  └─ shutdown.js
├─ config/
│  ├─ env.js
│  ├─ database.js
│  ├─ logger.js
│  ├─ security.js
│  ├─ payment.js
│  └─ push.js
├─ shared/
│  ├─ errors/
│  ├─ http/
│  ├─ middleware/
│  ├─ security/
│  ├─ observability/
│  ├─ messaging/
│  ├─ persistence/
│  └─ testing/
└─ modules/
   ├─ identity/
   ├─ catalog/
   ├─ booking/
   ├─ billing/
   ├─ communication/
   ├─ content/
   └─ operations/
```

Không tạo cây thư mục rỗng. Chỉ tạo module khi chuyển code thật và test thật.

## Cấu trúc feature mẫu

```text
src/modules/catalog/reviews/
├─ review.routes.js
├─ review.controller.js
├─ review.validation.js
├─ review.policy.js
├─ review.presenter.js
├─ application/
│  ├─ list-host-reviews.js
│  ├─ reply-to-review.js
│  ├─ moderate-review.js
│  └─ report-review.js
├─ domain/
│  ├─ review-state-machine.js
│  ├─ review-rules.js
│  ├─ review-events.js
│  └─ review-errors.js
├─ infrastructure/
│  ├─ review.model.js
│  ├─ review.mapper.js
│  ├─ review.repository.js
│  └─ rating-projection.js
├─ __tests__/
└─ index.js
```

Dependency direction:

```text
route
→ validation/policy
→ controller
→ application use case
→ domain
→ repository port
→ infrastructure adapter
```

Quy tắc:

- Route chỉ khai báo method/path/middleware/controller.
- Controller không query Mongoose và không chứa business rule.
- Application không phụ thuộc `req`, `res`, Express hoặc EJS.
- Domain không phụ thuộc Express, Mongoose, RabbitMQ, Stripe, Cloudinary, Socket.IO hoặc Web Push.
- Chỉ infrastructure import model/provider cụ thể.
- API trả DTO, không trả raw Mongoose document.
- Cross-module chỉ import qua public `index.js`.
- Không dynamic `require()` trong hàm nếu không có lý do/test.
- Không đọc `process.env` ngoài `config`.
- Không `console.*` trong production code.

---

# 4. KIẾN TRÚC MICROSERVICES ĐÍCH

```text
WorkHub/
├─ apps/
│  ├─ api-gateway/
│  ├─ web-bff/
│  └─ legacy-monolith/
├─ services/
│  ├─ identity-service/
│  ├─ catalog-service/
│  ├─ booking-service/
│  ├─ billing-service/
│  ├─ communication-service/
│  ├─ content-service/
│  ├─ operations-service/
│  └─ analytics-service/
├─ packages/
│  ├─ contracts/
│  ├─ observability/
│  ├─ security/
│  ├─ eslint-config/
│  └─ test-utils/
├─ infra/
│  ├─ gateway/
│  ├─ rabbitmq/
│  ├─ mongodb/
│  ├─ redis/
│  ├─ otel-collector/
│  ├─ prometheus/
│  ├─ grafana/
│  └─ loki/
├─ tests/
│  ├─ contract/
│  ├─ e2e/
│  ├─ security/
│  ├─ resilience/
│  └─ performance/
├─ docs/
│  ├─ architecture/
│  ├─ adr/
│  ├─ migration/
│  ├─ service-catalog/
│  └─ runbooks/
├─ package.json
├─ package-lock.json
└─ docker-compose.yml
```

Dùng npm workspaces ở giai đoạn đầu. Monorepo được phép nếu từng service build/test/deploy độc lập.

---

# 5. RANH GIỚI SERVICE

## Identity Service

Sở hữu:

- User identity
- credential/password
- login/logout
- JWT/JWKS
- session/revocation
- email verification
- password reset
- 2FA/TOTP
- WebAuthn/passkey
- platform role

Database: `workhub_identity`.

Không sở hữu host profile, booking, payment hoặc push subscription.

## Catalog Service

Sở hữu:

- host business profile
- branch
- space
- amenities
- listing images
- search
- review/host reply/moderation
- public rating projection
- space booking-policy source

Database: `workhub_catalog`.

Events:

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

## Booking Service

Sở hữu:

- booking aggregate/state machine
- slot reservation
- hold/expiry
- availability
- recurring/group booking/RSVP
- reschedule/cancellation
- check-in/check-out/no-show
- reception notes
- booking incidents
- idempotency
- Catalog local read model

Database: `workhub_booking`.

Không query Catalog DB. Consume event để giữ snapshot:

```text
spaceId
hostId
branchId
timezone
status
bufferBeforeMinutes
cleanupAfterMinutes
freeCancelHours
instantBook
policyVersion
```

## Billing Service

Sở hữu:

- quote/pricing/coupon
- payment/webhook
- refund/payout
- ledger
- membership/credit ledger
- reconciliation
- financial idempotency

Database: `workhub_billing`.

Quy tắc:

- webhook raw body chỉ ở Billing;
- không tin amount từ client;
- ledger append-only;
- external provider call không chạy trong DB transaction;
- mutation tiền phải idempotent.

## Communication Service

Sở hữu:

- Web Push subscription/delivery
- email delivery
- notification inbox
- message thread
- communication preferences
- retry/DLQ

Database: `workhub_communication`.

Consume booking/catalog/billing/identity events; không quyết định trạng thái các domain đó.

## Content Service

Sở hữu CMS, SEO redirects, sitemap source, i18n và public policy content.

Database: `workhub_content`.

## Operations Service

Sở hữu/tổng hợp:

- audit read model
- dead-letter UI
- export coordination
- reconciliation dashboard
- dispute case workflow
- system health aggregation
- runbook automation

Không sở hữu Booking aggregate hoặc Billing ledger.

## Analytics Service

Làm sau khi event contracts ổn định. Chỉ chứa read models, không nằm trong critical path.

---

# 6. API GATEWAY VÀ WEB BFF

## API Gateway

Là public entry duy nhất.

Trách nhiệm:

- TLS termination
- routing
- request ID
- trace propagation
- edge rate limiting
- body limit
- CORS
- coarse authentication
- canary/rollback routing
- giữ URL legacy

Không chứa business logic hoặc query DB.

Route map:

```text
/api/auth/*             → identity-service
/api/sessions/*         → identity-service
/api/hosts/*            → catalog-service
/api/branches/*         → catalog-service
/api/spaces/*           → catalog-service
/api/reviews/*          → catalog-service
/api/search/*           → catalog-service
/api/bookings/*         → booking-service
/api/reception/*        → booking-service
/api/incidents/*        → booking-service
/api/check-in/*         → booking-service
/api/payments/*         → billing-service
/api/refunds/*          → billing-service
/api/payouts/*          → billing-service
/api/membership/*       → billing-service
/api/push/*             → communication-service
/api/notifications/*    → communication-service
/api/messages/*         → communication-service
/api/content/*          → content-service
/api/admin/operations/* → operations-service
```

Route chưa extract proxy vào `legacy-monolith`.

## Web BFF

Sở hữu EJS rendering, customer/host/admin pages, view-model aggregation, CSRF browser flow và client assets.

Không query MongoDB. Không import Mongoose model.

---

# 7. DATABASE OWNERSHIP VÀ LEGACY MAPPER

Local có thể cùng Mongo cluster nhưng DB/credential riêng:

```text
workhub_identity
workhub_catalog
workhub_booking
workhub_billing
workhub_communication
workhub_content
workhub_operations
workhub_analytics
```

Cấm cross-service query/model/populate.

Không rename trực tiếp:

```text
FullName
HostID
CustomerID
SpaceID
Payment_History
Host_Profile
```

Dùng mapper:

```js
function toDomain(doc) {
  return {
    id: String(doc._id),
    hostId: doc.HostID ? String(doc.HostID) : null,
    customerId: doc.CustomerID ? String(doc.CustomerID) : null,
    fullName: doc.FullName || "",
    createdAt: doc.createdAt,
  };
}
```

API/event chỉ dùng camelCase.

---

# 8. RABBITMQ, OUTBOX, INBOX

Dùng RabbitMQ:

- durable queues/exchanges
- persistent messages
- publisher confirms
- manual acknowledgements
- bounded prefetch
- retry + backoff + jitter
- DLX/DLQ
- idempotent consumer
- schema version
- correlation/causation/trace IDs

Event envelope:

```json
{
  "eventId": "uuid",
  "eventType": "booking.confirmed.v1",
  "occurredAt": "ISO-8601",
  "producer": "booking-service",
  "aggregateId": "id",
  "aggregateVersion": 7,
  "correlationId": "uuid",
  "causationId": "uuid",
  "traceId": "string",
  "data": {}
}
```

Transactional Outbox:

```text
update aggregate
+ insert outbox event
+ commit
```

Publisher:

```text
claim → publish → wait confirm → mark published
```

Consumer Inbox:

```text
check processed_messages(eventId)
→ local transaction
→ record eventId
→ commit
→ ack
```

Không giả định exactly-once.

---

# 9. SAGA

## Booking–Payment

```text
Booking reserve slot
→ booking.hold-created.v1
→ Billing payment session
→ billing.payment-succeeded.v1
→ Booking confirm
→ booking.confirmed.v1
→ Communication notify
```

Failure:

```text
billing.payment-failed.v1
→ Booking expire hold
→ release slot
```

## Dispute–Refund

```text
Operations records resolution request
→ operations.dispute-resolution-requested.v1
→ Billing processes refund
→ billing.refund-completed.v1
→ Operations marks dispute resolved
→ Communication notifies actors
```

Failure:

```text
billing.refund-failed.v1
→ Operations marks resolution_failed
→ create retry/manual task
```

---

# 10. CẤU TRÚC MỖI SERVICE

```text
services/<service-name>/
├─ src/
│  ├─ bootstrap/
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
│  │  ├─ services/
│  │  ├─ events/
│  │  └─ errors/
│  ├─ infrastructure/
│  │  ├─ persistence/
│  │  ├─ messaging/
│  │  ├─ cache/
│  │  ├─ locks/
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

---

# 11. SECURITY VÀ OBSERVABILITY

- Identity ký asymmetric JWT và public JWKS.
- Gateway verify token nhưng từng service vẫn authorization theo resource/tenant/branch.
- Step-up/audit cho refund, payout, dispute, review removal, DLQ replay, force logout.
- Zod tại HTTP/message boundary.
- Secret manager/rotation.
- Không log JWT, password, TOTP, payment secrets, VAPID private/auth keys.

Mỗi service có:

```text
GET /health/live
GET /health/ready
GET /metrics
```

OpenTelemetry cho HTTP, MongoDB, RabbitMQ, exception và distributed trace.

Structured logs phải có requestId, traceId, spanId, correlationId, eventId, actorId, resourceId, errorCode và durationMs.

---

# 12. TESTING

Mỗi service:

- unit domain tests
- application tests
- repository integration tests
- API component tests
- event consumer tests
- outbox/inbox/idempotency tests
- authorization tests
- contract tests
- health/readiness tests

Toàn hệ thống:

- gateway routing E2E
- customer booking E2E
- host reception/check-in E2E
- payment/refund E2E
- review moderation E2E
- Web Push E2E
- duplicate/out-of-order event
- Rabbit/Mongo/provider failures
- saga compensation
- security regression
- data reconciliation

---

# 13. MIGRATION PHASES

## S0 — Baseline

- kiểm tra Git;
- tạo branch;
- lint/test/build/audit;
- ghi baseline;
- không đổi behavior.

## S1 — Stabilization

- sửa toàn bộ blocker mục 2;
- regression tests;
- CI xanh.

## S2 — Monolith boundaries

- tách controller/router theo domain;
- presenter/validation/repository;
- giữ contract.

## M1 — Monorepo

- npm workspaces;
- đưa monolith vào `apps/legacy-monolith`;
- giữ start script.

## M2 — API Gateway pass-through

- proxy 100% vào monolith;
- URL không đổi;
- E2E và rollback.

## M3 — Messaging foundation

- RabbitMQ;
- Outbox/Inbox;
- event schemas;
- OpenTelemetry;
- DLQ.

## M4 — Communication Service

Extract Web Push/notifications/email trước.

## M5 — Content Service

Extract CMS/SEO/i18n.

## M6 — Identity Service

Extract auth/session/2FA/WebAuthn.

## M7 — Catalog Service

Extract host/branch/space/review/search.

## M8 — Billing Service

Extract quote/payment/refund/payout/membership/ledger.

## M9 — Booking Service

Extract booking/slots/availability/reception/notes/incidents.

## M10 — Operations Service

Extract dispute case, audit, DLQ UI, reconciliation.

## M11 — Web BFF

Move EJS/page routes; không DB access.

## M12 — Analytics

Chỉ khi event contracts ổn định.

## M13 — Retire monolith

Chỉ khi không còn public route, domain worker, DB ownership hoặc production traffic.

---

# 14. QUY TẮC THỰC THI

1. Không làm toàn bộ phases trong một lượt.
2. Không tạo hàng trăm file rỗng.
3. Characterization test trước extraction.
4. Không move code cơ học.
5. Mỗi phase phải báo:
   - file thay đổi;
   - contract giữ lại;
   - test/lint/build/audit;
   - rollback;
   - rủi ro còn lại.
6. Không xóa compatibility shim trước cutover.
7. Không đổi API URL nếu chưa có gateway adapter.
8. Không rename legacy fields trong cùng migration.
9. Không gọi provider trong DB transaction.
10. Không publish event state-change quan trọng ngoài outbox.
11. Không shared DB.
12. Không import source/model của service khác.
13. Không tuyên bố hoàn thành nếu CI chưa xanh.
14. Không push/merge nếu người dùng chưa yêu cầu.

---

# 15. DEFINITION OF DONE

Chỉ gọi là microservices hoàn thành khi:

- Gateway là public entry.
- Web BFF không query DB.
- Identity/Catalog/Booking/Billing/Communication/Content/Operations deploy độc lập.
- Mỗi service có DB/credential riêng.
- Không cross-service query/model/populate.
- API/event versioned.
- Outbox/Inbox và idempotent consumers hoạt động.
- Saga được test.
- OpenTelemetry xuyên gateway, HTTP và message.
- CI/CD riêng.
- Security/contract/E2E/resilience tests xanh.
- Financial/booking reconciliation đạt.
- Monolith không còn production traffic.
- Có ADR, service catalog, runbook và rollback.

---

# 16. LỆNH BẮT ĐẦU DÀNH CHO CLAUDE

Đọc toàn bộ tài liệu này và **chỉ bắt đầu S0 + S1**.

1. Kiểm tra branch, `git status`, `git diff`.
2. Không làm mất thay đổi hiện tại.
3. Chạy baseline lint/test/build/audit.
4. Sửa blocker mục 2.
5. Viết regression tests.
6. Thêm GitHub Actions CI.
7. Tạo/cập nhật:
   - `docs/migration/baseline.md`
   - `docs/migration/current-system-map.md`
   - `docs/migration/service-boundaries.md`
   - `docs/migration/data-ownership.md`
   - `docs/migration/event-catalog.md`
   - `docs/migration/rollback-plan.md`
   - `MICROSERVICES_MIGRATION_REPORT.md`
8. Không bắt đầu M1 cho đến khi:
   - P0 = 0
   - P1 blocker = 0
   - lint pass
   - tests pass
   - build pass
   - CI pass

Sau S0/S1, báo bằng chứng và chờ lệnh tiếp tục M1.
