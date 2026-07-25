"use strict";

const { spawn } = require("child_process");
const path = require("path");
const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const JWT_SECRET = "test_jwt_secret_key_at_least_32_characters_long_for_workhub";
const CONTENT_SECRET = "test_content_internal_secret_key_at_least_32_chars";
const COMM_SECRET = "test_communication_internal_secret_key_at_least_32_chars";

let processes = {};
let contentConn;
let commConn;
let replset;
let uriContent;
let uriComm;
let mockAmqpPath;

const http = require("http");

function waitReady(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(false);
        return;
      }

      const req = http.get(url, (res) => {
        if (res.statusCode === 200) {
          clearInterval(interval);
          resolve(true);
        }
        res.resume();
      });

      req.on("error", () => {
        // ignore
      });

      req.end();
    }, 500);
  });
}

beforeAll(async () => {
  // Start Mongo Memory Replica Set
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const baseUri = replset.getUri();
  const urlObj = new URL(baseUri);
  const uriMonolith = `${urlObj.protocol}//${urlObj.host}/workhub_e2e_monolith${urlObj.search || ""}`;
  uriContent = `${urlObj.protocol}//${urlObj.host}/workhub_e2e_content${urlObj.search || ""}`;
  uriComm = `${urlObj.protocol}//${urlObj.host}/workhub_e2e_comm${urlObj.search || ""}`;

  // Setup database connections for direct inspection
  contentConn = await mongoose.createConnection(uriContent).asPromise();
  commConn = await mongoose.createConnection(uriComm).asPromise();

  // Pre-create collections to prevent replica set catalog changes transaction errors
  await contentConn.createCollection("content_pages");
  await contentConn.createCollection("seo_redirects");
  await contentConn.createCollection("translations");
  await contentConn.createCollection("audit_logs");
  await contentConn.createCollection("content_outbox");
  await contentConn.createCollection("processed_messages");

  await commConn.createCollection("push_subscriptions");
  await commConn.createCollection("notifications");
  await commConn.createCollection("communication_outbox");
  await commConn.createCollection("notification_preferences");
  await commConn.createCollection("processed_messages");

  mockAmqpPath = path.join(__dirname, "mock-amqp.js");

  // Spawn Monolith
  processes.monolith = spawn("node", ["-r", mockAmqpPath, path.join(__dirname, "../legacy-monolith/server.js")], {
    env: {
      ...process.env,
      PORT: "3001",
      MONGODB_URI: uriMonolith,
      JWT_SECRET,
      NODE_ENV: "e2e-test",
      PROCESS_ROLE: "web",
      ENABLE_TRANSACTIONS: "true",
    },
  });
  processes.monolith.stdout.on("data", (d) => console.log(`[Mono] ${d}`));
  processes.monolith.stderr.on("data", (d) => console.error(`[Mono Err] ${d}`));

  // Spawn Content Service
  processes.content = spawn("node", ["-r", mockAmqpPath, path.join(__dirname, "../../services/content-service/server.js")], {
    env: {
      ...process.env,
      PORT: "3003",
      MONGODB_CONTENT_URI: uriContent,
      CONTENT_INTERNAL_SECRET: CONTENT_SECRET,
      RABBITMQ_URL: "amqp://localhost:5672",
      NODE_ENV: "e2e-test",
      ENABLE_TRANSACTIONS: "true",
    },
  });
  processes.content.stdout.on("data", (d) => console.log(`[Content] ${d}`));
  processes.content.stderr.on("data", (d) => console.error(`[Content Err] ${d}`));

  // Spawn Communication Service
  processes.comm = spawn("node", ["-r", mockAmqpPath, path.join(__dirname, "../../services/communication-service/server.js")], {
    env: {
      ...process.env,
      PORT: "3002",
      MONGODB_COMMUNICATION_URI: uriComm,
      COMMUNICATION_INTERNAL_SECRET: COMM_SECRET,
      RABBITMQ_URL: "amqp://localhost:5672",
      NODE_ENV: "e2e-test",
      ENABLE_TRANSACTIONS: "true",
    },
  });
  processes.comm.stdout.on("data", (d) => console.log(`[Comm] ${d}`));
  processes.comm.stderr.on("data", (d) => console.error(`[Comm Err] ${d}`));

  // Spawn API Gateway
  processes.gateway = spawn("node", [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      PORT: "3000",
      LEGACY_MONOLITH_URL: "http://127.0.0.1:3001",
      CONTENT_SERVICE_URL: "http://127.0.0.1:3003",
      CONTENT_SERVICE_ENABLED: "true",
      CONTENT_CANARY_PERCENT: "100",
      CONTENT_INTERNAL_SECRET: CONTENT_SECRET,
      COMMUNICATION_SERVICE_URL: "http://127.0.0.1:3002",
      COMMUNICATION_SERVICE_ENABLED: "true",
      COMMUNICATION_CANARY_PERCENT: "100",
      COMMUNICATION_INTERNAL_SECRET: COMM_SECRET,
      JWT_SECRET,
      CORS_ALLOWED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000",
      NODE_ENV: "e2e-test",
    },
  });
  processes.gateway.stdout.on("data", (d) => console.log(`[Gateway] ${d}`));
  processes.gateway.stderr.on("data", (d) => console.error(`[Gateway Err] ${d}`));

  // Wait for all services to be ready
  const monolithReady = await waitReady("http://127.0.0.1:3001/health/ready");
  const contentReady = await waitReady("http://127.0.0.1:3003/ready");
  const commReady = await waitReady("http://127.0.0.1:3002/ready");
  const gatewayReady = await waitReady("http://127.0.0.1:3000/gateway/health/ready");

  if (!monolithReady || !contentReady || !commReady || !gatewayReady) {
    throw new Error(`Failed to initialize E2E services: Monolith=${monolithReady}, Content=${contentReady}, Comm=${commReady}, Gateway=${gatewayReady}`);
  }
}, 60000);

afterAll(async () => {
  // Kill processes
  for (const key of Object.keys(processes)) {
    processes[key].kill();
  }
  // Close database connections
  if (contentConn) await contentConn.close();
  if (commConn) await commConn.close();
  if (replset) await replset.stop();
});

describe("Real Gateway-to-Service E2E Integration Tests", () => {
  const adminUserId = new mongoose.Types.ObjectId().toString();

  function signToken(userId, role = "customer", opts = {}) {
    return jwt.sign(
      { userId, role },
      JWT_SECRET,
      {
        algorithm: "HS256",
        issuer: "workhub-auth",
        audience: "workhub-app",
        expiresIn: "1h",
        ...opts,
      }
    );
  }

  test("1. POST content page through Gateway saves in Content Service DB", async () => {
    const token = signToken(adminUserId, "admin");
    const payload = {
      title: "E2E Guide",
      body: "<p>Welcome to our E2E guide</p>",
      type: "guide",
      status: "published",
      reason: "E2E testing",
    };

    const res = await request("http://127.0.0.1:3000")
      .post("/api/content/pages")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.page.Slug).toBe("e2e-guide");

    // Inspect database directly
    const pageModel = contentConn.model("ContentPage", new mongoose.Schema({}, { strict: false }), "content_pages");
    const saved = await pageModel.findOne({ Slug: "e2e-guide" });
    expect(saved).toBeTruthy();
    expect(saved.get("Title")).toBe("E2E Guide");
    expect(saved.get("Version")).toBe(1);
  });

  test("2. POST push subscription through Gateway saves in Communication DB", async () => {
    const token = signToken(adminUserId, "customer");
    const payload = {
      endpoint: "https://fcm.googleapis.com/send/e2e-push-token",
      keys: { p256dh: "key_dh_p256dh_length_ok", auth: "auth_key_ok" },
    };

    const res = await request("http://127.0.0.1:3000")
      .post("/api/push/subscribe")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect([200, 201]).toContain(res.status);
    expect(res.body.subscription).toBeDefined();
    expect(res.body.subscription.Status).toBe("active");

    // Inspect database directly
    const subModel = commConn.model("PushSubscription", new mongoose.Schema({}, { strict: false }), "push_subscriptions");
    const saved = await subModel.findOne({ UserID: new mongoose.Types.ObjectId(adminUserId) });
    expect(saved).toBeTruthy();
    expect(saved.get("Endpoint")).toBe("https://fcm.googleapis.com/send/e2e-push-token");
  });

  test("3. Microservices reject requests directly (missing or invalid internal secret)", async () => {
    // Missing internal secret directly to Content Service -> 401
    const resDirectMissing = await request("http://127.0.0.1:3003")
      .post("/api/content/pages")
      .send({ title: "direct" });
    expect(resDirectMissing.status).toBe(401);

    // Invalid internal secret directly to Content Service -> 401
    const resDirectInvalid = await request("http://127.0.0.1:3003")
      .post("/api/content/pages")
      .set("x-internal-token", "wrong-secret")
      .set("x-service-name", "api-gateway")
      .send({ title: "direct" });
    expect(resDirectInvalid.status).toBe(401);
  });

  test("4. Spoofed identity headers from client are stripped", async () => {
    const token = signToken(adminUserId, "admin");
    const payload = {
      title: "Spoofed Guide",
      body: "Safe content",
      status: "published",
      reason: "security testing",
    };

    // Client attempts to spoof x-user-id and override scopes
    const res = await request("http://127.0.0.1:3000")
      .post("/api/content/pages")
      .set("Authorization", `Bearer ${token}`)
      .set("x-user-id", "attacker-user-id")
      .set("x-user-role", "attacker-role")
      .send(payload);

    expect(res.status).toBe(200);
    // Inspect database to verify it was authorId was set to correct adminUserId (not attacker-user-id)
    const pageModel = contentConn.model("ContentPage", new mongoose.Schema({}, { strict: false }), "content_pages");
    const saved = await pageModel.findOne({ Slug: "spoofed-guide" });
    expect(saved).toBeTruthy();
    expect(String(saved.get("AuthorID"))).toBe(adminUserId);
  });

  test("5. JWT token validation checks", async () => {
    const payload = { title: "Token test", body: "text", reason: "token test" };

    // Expired token -> 401
    const expiredToken = signToken(adminUserId, "admin", { expiresIn: "-1s" });
    const resExpired = await request("http://127.0.0.1:3000")
      .post("/api/content/pages")
      .set("Authorization", `Bearer ${expiredToken}`)
      .send(payload);
    expect(resExpired.status).toBe(401);

    // Wrong issuer -> 401
    const wrongIssuer = signToken(adminUserId, "admin", { issuer: "wrong-issuer" });
    const resIssuer = await request("http://127.0.0.1:3000")
      .post("/api/content/pages")
      .set("Authorization", `Bearer ${wrongIssuer}`)
      .send(payload);
    expect(resIssuer.status).toBe(401);

    // Wrong audience -> 401
    const wrongAudience = signToken(adminUserId, "admin", { audience: "wrong-audience" });
    const resAudience = await request("http://127.0.0.1:3000")
      .post("/api/content/pages")
      .set("Authorization", `Bearer ${wrongAudience}`)
      .send(payload);
    expect(resAudience.status).toBe(401);
  });

  test("6. Routing paths are preserved intact (not stripped)", async () => {
    const token = signToken(adminUserId, "admin");
    const payload = {
      title: "Path test guide",
      body: "hello path",
      status: "published",
      reason: "testing paths",
    };

    // The Content Service exposes POST `/api/content/pages`.
    // If the Gateway strips the prefix `/api/content` and sends `/pages`, it would 404.
    // Asserting 200 proves the target receives the complete intact path `/api/content/pages`.
    const res = await request("http://127.0.0.1:3000")
      .post("/api/content/pages")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.page.Slug).toBe("path-test-guide");
  });

  test("7. Gateway returns 502 when backend microservice is down", async () => {
    const token = signToken(adminUserId, "admin");

    // Kill the content service
    processes.content.kill();

    // Verify requesting content endpoint returns 502
    const res = await request("http://127.0.0.1:3000")
      .post("/api/content/pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Down test" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Content Service Unavailable");

    // Respawn Content Service to prevent cleanup issues in afterAll
    processes.content = spawn("node", ["-r", mockAmqpPath, path.join(__dirname, "../../services/content-service/server.js")], {
      env: {
        ...process.env,
        PORT: "3003",
        MONGODB_CONTENT_URI: uriContent,
        CONTENT_INTERNAL_SECRET: CONTENT_SECRET,
        RABBITMQ_URL: "amqp://localhost:5672",
        NODE_ENV: "e2e-test",
        ENABLE_TRANSACTIONS: "true",
      },
    });
    await waitReady("http://127.0.0.1:3003/ready");
  });
});
