# WORKHUB — ALL-IN-ONE MASTER PLAN
## Ổn định monolith, tái cấu trúc code và chuyển đổi sang microservices thật

> **Đây là tài liệu duy nhất Claude Code cần đọc.**
>
> Không yêu cầu trước các file báo cáo khác. Nếu một report hoặc tài liệu migration chưa tồn tại, Claude phải tự tạo theo chỉ dẫn trong file này.
>
> Đích cuối: microservices thật.  
> Phương pháp: Strangler Fig, chuyển đổi tăng dần, có test và rollback.  
> Không big-bang rewrite.

---

# A. LỆNH DÙNG FILE NÀY

Đặt file tại:

```text
D:\WorkHub\WORKHUB_ALL_IN_ONE_MICROSERVICES_MASTER.md
```

Trong Claude Code, nhập:

```text
Đọc toàn bộ WORKHUB_ALL_IN_ONE_MICROSERVICES_MASTER.md và xem đây là nguồn sự thật duy nhất cho quá trình tái cấu trúc WorkHub.

Không yêu cầu tôi cung cấp thêm MICROSERVICES_MIGRATION_REPORT.md hoặc tài liệu migration khác. File nào chưa tồn tại thì tự tạo theo đặc tả trong tài liệu này.

Bắt đầu từ CURRENT_PHASE trong MICROSERVICES_MIGRATION_REPORT.md nếu report đã tồn tại. Nếu report chưa tồn tại, bắt đầu S0.

Không reset, checkout, clean hoặc xóa thay đổi hiện tại.
Không sửa trực tiếp main.
Không push, merge, force-push hoặc rewrite Git history.
Không big-bang rewrite.
Không tạo hàng loạt thư mục/service rỗng.
Mỗi phase phải có test, bằng chứng, report và rollback.
```

---

# B. VAI TRÒ

Bạn là:

- Principal Software Architect;
- Principal Node.js Engineer;
- Distributed Systems Engineer;
- Application Security Engineer;
- Test Architect;
- Migration Lead.

Bạn chịu trách nhiệm tái cấu trúc WorkHub hiện tại:

- Node.js;
- Express 5;
- EJS;
- MongoDB/Mongoose;
- CommonJS;
- Jest;
- Socket.IO;
- background jobs;
- authentication/session/2FA/WebAuthn;
- booking;
- payment/refund/payout;
- review;
- Web Push;
- customer/host/staff/admin workflows.

Đích cuối là hệ thống microservices có thể triển khai và vận hành độc lập.

---

# C. NGUYÊN TẮC TỐI CAO

1. Khóa hành vi hiện tại bằng characterization và contract tests trước khi move code.
2. Giữ nguyên public URL, cookie, JWT, CSRF, webhook và response contract trong migration.
3. Không xóa dữ liệu.
4. Không rename trực tiếp legacy MongoDB fields trong giai đoạn đầu.
5. Không đổi toàn bộ framework hoặc ngôn ngữ trong cùng migration.
6. Không chuyển đồng thời sang TypeScript, Kubernetes và micro-frontends.
7. Tách theo business capability/bounded context, không tách theo tên kỹ thuật chung chung.
8. Mỗi service cuối cùng phải:
   - chạy process/container riêng;
   - build riêng;
   - test riêng;
   - deploy riêng;
   - scale riêng;
   - có database ownership;
   - có API/event contract;
   - có health/readiness/metrics/logs/traces;
   - có rollback riêng.
9. Không shared database.
10. Không query collection của service khác.
11. Không import Mongoose model hoặc source code của service khác.
12. Không distributed MongoDB transaction xuyên service.
13. Dùng Saga, Transactional Outbox và idempotent consumers.
14. Không gọi external provider trong DB transaction.
15. Không publish event quan trọng ngoài Outbox.
16. Không tuyên bố hoàn thành nếu CI chưa xanh.
17. Không che giấu lỗi baseline.
18. Không tạo abstraction hoặc service rỗng chỉ để trông giống enterprise.
19. Mỗi phase phải có exit criteria rõ.
20. Mỗi phase phải cập nhật report.

---

# D. QUY TẮC GIT

## D1. Không làm mất công việc

Trước mọi thay đổi lớn:

```bash
git status --short --branch
git diff --stat
git diff --check
```

Không được tự chạy:

```bash
git reset --hard
git clean -fd
git checkout -- .
git restore .
```

## D2. Branch

Nếu đang ở `main`, tạo branch:

```bash
git switch -c refactor/microservices-strangler
```

Nếu đang ở một feature branch có thay đổi stabilization hợp lệ:

1. kiểm tra diff;
2. chạy test;
3. tạo local checkpoint commit nếu cần;
4. sau đó tạo/chuyển branch microservices.

## D3. Commit

Dùng Conventional Commits.

Checkpoint gợi ý:

```text
fix: complete monolith stabilization
refactor: establish npm workspace monorepo
feat: add pass-through API gateway
feat: add messaging and outbox foundation
feat: extract communication service
```

Không push hoặc merge nếu người dùng chưa yêu cầu.

---

# E. REPORT DUY NHẤT PHẢI DUY TRÌ

File sau **có thể chưa tồn tại**:

```text
MICROSERVICES_MIGRATION_REPORT.md
```

Nếu chưa có, tự tạo tại repository root.

## E1. Cấu trúc report bắt buộc

```markdown
# WorkHub Microservices Migration Report

## Repository state
- Current branch:
- Current HEAD:
- Working tree:
- Last verified date:

## Current phase
CURRENT_PHASE: S0
STATUS: IN_PROGRESS

## Phase status
| Phase | Status | Evidence | Blockers |
|---|---|---|---|
| S0 | ... | ... | ... |
| S1 | ... | ... | ... |
| S2 | ... | ... | ... |
| M1 | ... | ... | ... |
...
| M13 | ... | ... | ... |

## Baseline
## Completed changes
## Tests and commands
## CI status
## API contracts preserved
## Database ownership decisions
## Event catalog
## Compatibility shims
## Rollback plan
## Risks and technical debt
## Next actions
```

Trạng thái hợp lệ:

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
COMPLETED
VERIFIED
```

Không đánh dấu `VERIFIED` chỉ dựa trên lời kể trong report cũ. Phải có output kiểm chứng hoặc CI.

---

# F. TÀI LIỆU MIGRATION PHẢI TỰ TẠO

Nếu thiếu, tạo:

```text
docs/migration/baseline.md
docs/migration/current-system-map.md
docs/migration/service-boundaries.md
docs/migration/data-ownership.md
docs/migration/event-catalog.md
docs/migration/rollback-plan.md
docs/migration/monorepo-m1.md
```

Tạo thêm ADR khi có quyết định khó đảo ngược:

```text
docs/adr/ADR-001-monorepo.md
docs/adr/ADR-002-service-boundaries.md
docs/adr/ADR-003-messaging-rabbitmq.md
docs/adr/ADR-004-database-per-service.md
docs/adr/ADR-005-saga-and-outbox.md
```

---

# G. BLOCKER PHẢI SỬA TRƯỚC MICROSERVICES

Không bắt đầu M1 nếu các blocker sau chưa được xử lý và test.

## G1. Dispute–Refund consistency

### Không được làm

```text
Mongo transaction đang mở
→ gọi refund provider
→ provider hoàn tiền thật
→ transaction lỗi và rollback DB
```

External side effect không thể rollback bằng MongoDB.

### State machine

```text
open
under_review
resolution_pending
refund_pending
resolved
rejected
resolution_failed
```

### Luồng đúng

```text
Admin yêu cầu resolve
→ Dispute = resolution_pending
→ Refund = requested/provider_pending
→ OutboxEvent = billing.refund-requested.v1
→ commit Mongo transaction
→ worker gọi provider
→ provider thành công
→ Refund = completed
→ emit billing.refund-completed.v1
→ Dispute = resolved
```

Nếu provider lỗi:

```text
Refund = failed hoặc provider_pending
Dispute = resolution_failed hoặc refund_pending
Admin retry bằng idempotency key
```

### Test bắt buộc

- provider không được gọi trước commit;
- rollback DB không thể tạo completed refund giả;
- dispute không `resolved` khi refund pending;
- duplicate command không refund hai lần;
- two-admin concurrency;
- refund amount vượt net paid;
- provider timeout;
- manual refund evidence;
- reconciliation.

---

## G2. `freeCancelHours = 0`

Cấm:

```js
Number(value) || 24
```

Dùng:

```js
const parsed = Number(value);
if (!Number.isFinite(parsed)) {
  throw new ValidationError("freeCancelHours không hợp lệ.");
}
updates.FreeCancelHours = Math.max(0, Math.min(168, parsed));
```

Integration test:

```text
PATCH /api/host/spaces/:spaceId/ops
body: { freeCancelHours: 0 }
expect persisted FreeCancelHours === 0
```

Test thêm:

- undefined: không đổi;
- `"abc"`: 400;
- -1: reject hoặc clamp theo policy thống nhất;
- 169: reject hoặc clamp theo policy thống nhất;
- non-owner: forbidden/not found;
- `runValidators: true`.

---

## G3. Review rating projection

- Chỉ tính `Status === "published"`.
- Nếu review public cuối cùng bị hidden/removed:
  - `Space.RatingAvg = 0`;
  - `Branch.RatingAvg = 0` nếu không còn review public.
- Mongoose post hook phải `async` và `await`.
- Dùng structured logger, không `console.error`.
- Có retry/reconciliation.
- Đích sau này là event + projection worker.

Test:

- published -> hidden;
- hidden -> published;
- last public review removed;
- concurrent moderation;
- projection retry;
- branch và space rating.

---

## G4. Web Push

### Dependency

Khai báo trực tiếp:

```text
web-push
ipaddr.js
```

Không dựa vào transitive dependency.

### Validation

- endpoint bắt buộc HTTPS;
- length giới hạn;
- hostname hợp lệ;
- `p256dh` và `auth` bắt buộc;
- base64url validation;
- user-agent giới hạn;
- subscription/user cap;
- rate limit.

### SSRF/DNS rebinding

Chặn:

- loopback;
- private;
- link-local;
- multicast;
- reserved;
- carrier-grade NAT nếu policy yêu cầu;
- IPv4-mapped IPv6.

Ưu tiên allowlist các push-provider hostname được hỗ trợ.

Nếu không thể allowlist hoàn toàn, outbound adapter phải xác minh DNS/IP tại thời điểm kết nối, kiểm soát redirect và timeout.

### Data minimization

Không trả:

- raw endpoint;
- `auth`;
- `p256dh`;
- internal error/provider details.

DTO:

```json
{
  "subscriptionId": "...",
  "deviceName": "...",
  "createdAt": "...",
  "status": "active"
}
```

### Delivery

Không gửi tuần tự trong request.

Dùng queue/worker:

- retry 429/5xx;
- exponential backoff + jitter;
- revoke 404/410;
- DLQ;
- attempt audit;
- timeout;
- concurrency limit.

---

## G5. CI thật

Tạo GitHub Actions workflow:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint:security-ui
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - run: npm run audit:prod
```

Điều chỉnh Node version theo `package.json`.

Không ghi “CI pass” nếu chỉ chạy local.

---

# H. CẤU TRÚC CODE TRUNG GIAN TRONG MONOLITH

Trước khi extract service, chuẩn hóa monolith để ranh giới dễ cắt.

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

Không tạo toàn bộ cây rỗng. Chỉ tạo module khi có code thật và test thật được move.

---

# I. CẤU TRÚC FEATURE CHUẨN

Ví dụ Review:

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

Dependency:

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

- Route chỉ method/path/middleware/controller.
- Controller không query Mongoose.
- Controller không business logic.
- Application không phụ thuộc `req`, `res`, Express, EJS.
- Domain không phụ thuộc Express/Mongoose/RabbitMQ/Stripe/Cloudinary/Socket.IO/Web Push.
- Infrastructure mới import model/provider.
- API trả DTO, không raw document.
- Cross-module chỉ import public API.
- Không đọc `process.env` ngoài config.
- Không `console.*` trong production code.
- Không dynamic require vô lý.
- Không circular dependency.

---

# J. KIẾN TRÚC MICROSERVICES ĐÍCH

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

Dùng npm workspaces.

Monorepo không làm mất tính chất microservices nếu từng service build/test/deploy độc lập.

---

# K. SERVICE BOUNDARIES

## K1. Identity Service

Sở hữu:

- identity;
- credentials;
- login/logout;
- JWT/JWKS;
- sessions;
- token revocation;
- email verification;
- password reset;
- 2FA/TOTP;
- WebAuthn/passkey;
- platform role.

Database:

```text
workhub_identity
```

Không sở hữu host business profile, booking, payment hoặc push subscription.

---

## K2. Catalog Service

Sở hữu:

- host business profile;
- branch;
- space;
- amenities;
- images metadata;
- listing/search;
- review;
- host reply;
- moderation;
- rating projection;
- space booking-policy source.

Database:

```text
workhub_catalog
```

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

---

## K3. Booking Service

Sở hữu:

- booking aggregate;
- state machine;
- slot reservation;
- holds;
- availability;
- recurring/group booking/RSVP;
- reschedule;
- cancellation;
- check-in/check-out/no-show;
- reception notes;
- booking incidents;
- idempotency;
- Catalog local read model.

Database:

```text
workhub_booking
```

Catalog snapshot:

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

---

## K4. Billing Service

Sở hữu:

- quote;
- pricing;
- coupon;
- payment;
- provider webhook;
- refund;
- payout;
- ledger;
- membership;
- credit ledger;
- reconciliation;
- financial idempotency.

Database:

```text
workhub_billing
```

Quy tắc:

- raw webhook body chỉ ở Billing;
- không tin amount client;
- append-only ledger;
- external provider ngoài transaction;
- idempotency bắt buộc.

---

## K5. Communication Service

Sở hữu:

- Web Push subscription/delivery;
- email delivery;
- notification inbox;
- messages;
- preferences;
- retries/DLQ.

Database:

```text
workhub_communication
```

Không quyết định Booking/Billing/Catalog state.

---

## K6. Content Service

Sở hữu:

- CMS;
- SEO redirect;
- sitemap source;
- i18n;
- public policy content.

Database:

```text
workhub_content
```

---

## K7. Operations Service

Sở hữu hoặc tổng hợp:

- audit read model;
- dead-letter UI;
- export coordination;
- reconciliation dashboard;
- dispute case workflow;
- system health aggregation;
- runbook automation.

Không sở hữu Billing ledger hoặc Booking aggregate.

---

## K8. Analytics Service

Làm sau khi contracts ổn định.

Chỉ read models:

- RUM;
- funnel;
- rating trend;
- host dashboard;
- revenue analytics;
- platform statistics.

Không nằm trong critical path.

---

# L. API GATEWAY VÀ WEB BFF

## L1. API Gateway

Public entry duy nhất.

Trách nhiệm:

- TLS;
- routing;
- request ID;
- trace propagation;
- edge rate limit;
- body limit;
- CORS;
- coarse authentication;
- canary;
- rollback;
- legacy URL compatibility.

Không business logic. Không DB.

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

Route chưa extract proxy vào legacy monolith.

## L2. Web BFF

Sở hữu:

- EJS rendering;
- customer pages;
- host pages;
- admin pages;
- view-model aggregation;
- CSRF browser flow;
- client assets.

Không query MongoDB. Không import model.

---

# M. DATABASE OWNERSHIP

Local có thể cùng Mongo cluster nhưng database và credential riêng:

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

Cấm:

```text
booking-service → query catalog DB
billing-service → query booking DB
catalog-service → populate Identity User
communication-service → query toàn bộ DB
```

Thay bằng:

- typed REST client khi cần đồng bộ;
- event;
- local read model;
- immutable snapshot.

---

# N. LEGACY FIELD MAPPER

Không rename ngay:

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

API/event dùng camelCase.

---

# O. RABBITMQ, OUTBOX VÀ INBOX

Dùng RabbitMQ:

- durable exchanges/queues;
- persistent messages;
- publisher confirms;
- manual acknowledgements;
- bounded prefetch;
- retries;
- exponential backoff + jitter;
- DLX/DLQ;
- idempotent consumers;
- versioned schemas;
- correlation/causation/trace IDs.

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
claim → publish → publisher confirm → mark published
```

Inbox:

```text
check eventId
→ local transaction
→ record processed_messages
→ commit
→ ack
```

Không giả định exactly-once.

---

# P. SAGA

## P1. Booking–Payment

```text
Booking reserve slot
→ booking.hold-created.v1
→ Billing creates payment session
→ billing.payment-succeeded.v1
→ Booking confirms
→ booking.confirmed.v1
→ Communication notifies
```

Failure:

```text
billing.payment-failed.v1
→ Booking expires hold
→ release slot
```

## P2. Dispute–Refund

```text
Operations records resolution request
→ operations.dispute-resolution-requested.v1
→ Billing processes refund
→ billing.refund-completed.v1
→ Operations marks dispute resolved
→ Communication notifies
```

Failure:

```text
billing.refund-failed.v1
→ Operations marks resolution_failed
→ retry/manual task
```

---

# Q. SERVICE INTERNAL STRUCTURE

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

# R. SECURITY

## Authentication

- asymmetric JWT;
- JWKS;
- short-lived access token;
- secure HttpOnly cookies;
- session revoke;
- 2FA/WebAuthn;
- key rotation.

## Authorization

Gateway authentication không thay service authorization.

Mỗi service kiểm tra:

- role/scope;
- tenant;
- host ownership;
- branch access;
- resource ownership;
- state transition.

## Sensitive admin actions

Step-up/audit cho:

- refund;
- payout;
- dispute resolution;
- review removal;
- DLQ replay;
- force logout.

Cân nhắc maker-checker theo ngưỡng tiền.

## Validation

Zod tại HTTP/message boundary.

Không đưa raw request body vào domain.

## Secrets

- không commit;
- không log;
- rotation;
- service-specific secrets;
- separate DB credentials.

---

# S. OBSERVABILITY

Mỗi service:

```text
GET /health/live
GET /health/ready
GET /metrics
```

OpenTelemetry cho:

- HTTP server/client;
- MongoDB;
- RabbitMQ publish/consume;
- errors;
- distributed traces.

Structured logs:

```text
timestamp
level
service
version
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

- passwords;
- JWT;
- session secrets;
- payment credentials;
- TOTP/recovery codes;
- VAPID private/auth keys;
- raw API keys.

---

# T. TESTING

Mỗi service:

- unit domain tests;
- application tests;
- repository integration tests;
- API component tests;
- event consumer tests;
- outbox/inbox tests;
- idempotency tests;
- authorization tests;
- contract tests;
- health/readiness tests.

Toàn hệ thống:

- gateway routing E2E;
- customer booking E2E;
- host reception/check-in E2E;
- payment/refund E2E;
- review moderation E2E;
- Web Push E2E;
- duplicate event;
- out-of-order event;
- Rabbit outage;
- Mongo outage;
- provider timeout;
- saga compensation;
- security regression;
- performance smoke;
- reconciliation.

---

# U. PHASES VÀ EXACT EXECUTION PLAN

## S0 — Baseline

### Công việc

1. Inspect Git.
2. Inventory routes/controllers/services/models/jobs/webhooks/socket events/providers.
3. Chạy:

```bash
npm ci
npm run lint:security-ui
npm run lint
npm test
npm run build
npm run audit:prod
```

4. Ghi baseline.
5. Tạo report/docs nếu thiếu.
6. Không đổi behavior.

### Exit

- baseline documented;
- branch safe;
- working tree understood;
- no hidden failures.

---

## S1 — Stabilization

### Công việc

- sửa toàn bộ blocker G1–G5;
- regression tests;
- CI workflow;
- contract freeze.

### Exit

- P0 = 0;
- P1 blocker = 0;
- local checks pass;
- CI actually passes;
- report updated.

---

## S2 — Monolith boundaries

### Công việc

- tách God Controllers/Routers theo domain;
- validation/presenter/repository boundaries;
- no API contract change;
- không extract service.

### Exit

- controllers thin;
- no route calling business DB logic directly;
- tests green.

---

## M1 — npm Workspaces Monorepo

### Mục tiêu

Chuyển repo thành monorepo nhưng giữ monolith hoạt động nguyên vẹn.

### Root package.json

```json
{
  "private": true,
  "workspaces": [
    "apps/*",
    "services/*",
    "packages/*"
  ]
}
```

Giữ một root `package-lock.json`.

Root scripts phải tương thích:

```text
npm start
npm run dev
npm test
npm run lint
npm run lint:security-ui
npm run build
npm run audit:prod
```

Có thể proxy:

```text
npm run test --workspace=@workhub/legacy-monolith
```

### Di chuyển theo nhóm

1. Tạo `apps/legacy-monolith`.
2. Tạo package workspace.
3. Di chuyển entry/config.
4. Di chuyển backend source.
5. Di chuyển views/public.
6. Di chuyển tests.
7. Cập nhật paths/scripts/Docker.
8. Kiểm tra sau mỗi nhóm.

Giữ root:

```text
.git
.github
docs
infra
package.json
package-lock.json
docker-compose.yml
migration reports/prompts
```

Không tạo service rỗng. Chưa Gateway. Chưa RabbitMQ. Chưa extract domain.

### Kiểm chứng

```bash
npm ci
npm run lint:security-ui
npm run lint
npm test
npm run build
npm run audit:prod
```

Test start web/worker từ root.

### Artifacts

```text
docs/migration/monorepo-m1.md
MICROSERVICES_MIGRATION_REPORT.md
README.md
CLAUDE.md
```

### Exit

- all checks green;
- no duplicated source;
- compatibility preserved;
- local checkpoint:
  `refactor: establish npm workspace monorepo`.

Không tự bắt đầu M2 nếu policy yêu cầu phase gate.

---

## M2 — Pass-through API Gateway

### Mục tiêu

Tạo `apps/api-gateway`, proxy toàn bộ traffic vào legacy monolith.

### Bắt buộc

- request ID;
- trace headers;
- timeouts;
- body limits;
- CORS;
- rate limit;
- proxy error handling;
- health/readiness;
- config-driven routing;
- canary/rollback flag.

Không business logic. Không DB.

### Test

- public/API URLs unchanged;
- cookies preserved;
- CSRF flow preserved;
- raw webhook preserved;
- streaming/socket behavior checked;
- monolith direct vs gateway contract comparison.

### Exit

- 100% pass-through traffic works;
- rollback to direct monolith tested;
- checkpoint commit.

---

## M3 — Messaging Foundation

### Mục tiêu

RabbitMQ + Outbox + Inbox + OTel.

### Thành phần

```text
packages/contracts
packages/observability
packages/test-utils
infra/rabbitmq
infra/otel-collector
```

Không chia sẻ domain models.

### Test

- publisher confirms;
- consumer ack;
- duplicate message;
- crash after commit before publish;
- crash after processing before ack;
- retry/DLQ;
- trace propagation.

### Exit

- reference implementation verified;
- no business extraction yet unless explicitly approved.

---

## M4 — Communication Service

Extract trước:

- PushSubscription;
- push delivery;
- notifications;
- email delivery.

Monolith phát event/outbox.

### Migration

- backfill subscriptions;
- shadow delivery;
- delivery reconciliation;
- feature flag/canary;
- rollback.

### Exit

- Communication independently deployable;
- monolith no longer owns push delivery path.

---

## M5 — Content Service

Extract:

- CMS;
- SEO redirects;
- sitemap;
- i18n;
- public policies.

Web BFF/gateway consume service.

---

## M6 — Identity Service

Extract:

- auth;
- sessions;
- JWT/JWKS;
- 2FA;
- WebAuthn;
- verification/reset.

### Bắt buộc

- auth contract tests;
- cookie/CSRF preserved;
- dual-read controlled;
- migration/backfill idempotent;
- rollback.

---

## M7 — Catalog Service

Extract:

- host;
- branch;
- space;
- review;
- rating;
- search.

Publish space-policy events for Booking read model.

---

## M8 — Billing Service

Extract:

- quote;
- pricing;
- payment;
- refund;
- payout;
- membership;
- ledger;
- reconciliation.

### Bắt buộc

- raw webhook signature;
- financial idempotency;
- append-only ledger;
- provider outside DB transaction;
- reconciliation;
- dispute-refund Saga.

---

## M9 — Booking Service

Extract:

- booking;
- slots;
- holds;
- availability;
- recurring/group;
- reception;
- notes;
- incidents;
- check-in/out.

### Bắt buộc

- concurrency tests;
- no double booking;
- Catalog local read model;
- Billing Saga;
- staff branch authorization;
- canary and shadow comparison.

---

## M10 — Operations Service

Extract:

- dispute case;
- audit projection;
- DLQ UI;
- reconciliation dashboard;
- exports;
- system-health aggregation.

---

## M11 — Web BFF

Move:

- EJS;
- page routes;
- customer/host/admin rendering;
- view-model aggregation.

No DB access.

Tách admin pages theo domain, không God Admin page.

---

## M12 — Analytics

Chỉ khi event schemas ổn định.

Read-only projections, không critical path.

---

## M13 — Retire Monolith

Chỉ khi:

- no public route;
- no domain worker;
- no DB ownership;
- no production traffic;
- full contract/E2E/security/resilience tests green;
- rollback/archive plan tested;
- observation window complete.

Archive, không xóa lịch sử.

---

# V. DATA MIGRATION PROCEDURE

Mỗi service cần:

```text
migration plan
backfill script
verification script
reconciliation report
cutover flag
rollback plan
```

Quy trình:

1. Backup/snapshot.
2. Idempotent backfill.
3. Verify count/checksum/business totals.
4. Delta sync.
5. Shadow reads.
6. Canary.
7. Cutover.
8. Observe.
9. Disable old writer.
10. Remove compatibility only later.

Không dual-write tùy tiện.

---

# W. CI/CD CHO MỖI SERVICE

Pipeline:

1. npm ci;
2. lint;
3. unit;
4. integration;
5. contract;
6. security audit;
7. SBOM;
8. container build;
9. image scan;
10. deploy;
11. smoke;
12. rollback.

Chỉ build/deploy service bị ảnh hưởng.

Docker Compose trước. Kubernetes chỉ khi có nhu cầu vận hành thật.

---

# X. DEFINITION OF DONE

Chỉ gọi hoàn tất khi:

- Gateway là public entry.
- Web BFF không query DB.
- Identity/Catalog/Booking/Billing/Communication/Content/Operations deploy độc lập.
- DB/credentials riêng.
- No cross-service DB/model/populate.
- API/event versioned.
- Outbox/Inbox verified.
- Idempotent consumers.
- Sagas tested.
- OTel traces across gateway/HTTP/messages.
- Independent CI/CD.
- Security/contract/E2E/resilience tests green.
- Financial/booking reconciliation correct.
- Monolith has no production traffic.
- ADR, service catalog, runbooks and rollback exist.

---

# Y. CÁCH CLAUDE TIẾP TỤC SAU KHI CONTEXT ĐẦY

Khi mở phiên mới:

```text
Đọc WORKHUB_ALL_IN_ONE_MICROSERVICES_MASTER.md và MICROSERVICES_MIGRATION_REPORT.md.

Xác định CURRENT_PHASE và STATUS trong report.
Kiểm tra Git và code thật.
Tiếp tục đúng phase đang dở.
Không lặp lại discovery đã có bằng chứng.
Không tự nhảy phase.
```

Nếu report chưa có, tạo report và bắt đầu S0.

---

# Z. TÀI LIỆU THAM KHẢO CHÍNH THỨC

- AWS — Strangler Fig Pattern  
  https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-decomposing-monoliths/strangler-fig.html

- npm — package.json workspaces  
  https://docs.npmjs.com/cli/v11/configuring-npm/package-json/

- RabbitMQ — Consumer Acknowledgements and Publisher Confirms  
  https://www.rabbitmq.com/docs/confirms

- OpenTelemetry — Concepts and Specification Overview  
  https://opentelemetry.io/docs/concepts/  
  https://opentelemetry.io/docs/specs/otel/overview/

---

# FINAL EXECUTION INSTRUCTION

Đọc toàn bộ file này.

1. Nếu `MICROSERVICES_MIGRATION_REPORT.md` chưa có, tự tạo.
2. Xác định phase thật từ Git, code, docs và test output.
3. Nếu S0/S1 chưa VERIFIED, hoàn thành S0/S1.
4. Nếu S0/S1 VERIFIED, tạo checkpoint an toàn và bắt đầu M1.
5. Chỉ thực hiện một phase lớn tại một thời điểm.
6. Sau mỗi phase:
   - chạy checks;
   - cập nhật report;
   - ghi rollback;
   - tạo local checkpoint nếu phù hợp;
   - không push/merge.
7. Không yêu cầu người dùng cung cấp các file report được định nghĩa trong tài liệu này; tự tạo chúng khi thiếu.
