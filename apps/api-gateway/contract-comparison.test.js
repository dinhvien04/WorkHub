"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_key_at_least_32_characters_long_for_workhub";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/test-db";

const request = require("supertest");
const http = require("http");
const { createApp } = require("../legacy-monolith/app");
const { startMemoryMongo, stopMemoryMongo } = require("../legacy-monolith/test/helpers");

let monolithServer;
let monolithPort;
let gatewayServer;
let gatewayPort;

beforeAll(async () => {
  // Start in-memory MongoDB first
  await startMemoryMongo();

  // Create and start legacy monolith Express app
  const monolithApp = createApp();
  monolithServer = http.createServer(monolithApp);
  await new Promise((resolve) => monolithServer.listen(0, resolve));
  monolithPort = monolithServer.address().port;

  // Set the gateway legacy monolith URL destination to our running monolith port
  process.env.LEGACY_MONOLITH_URL = `http://localhost:${monolithPort}`;

  // Force require the fresh gateway server with the updated environment variable
  jest.isolateModules(() => {
    const { app: gatewayApp } = require("./server");
    gatewayServer = http.createServer(gatewayApp);
  });

  await new Promise((resolve) => gatewayServer.listen(0, resolve));
  gatewayPort = gatewayServer.address().port;
});

afterAll(async () => {
  if (gatewayServer) {
    await new Promise((resolve) => gatewayServer.close(resolve));
  }
  if (monolithServer) {
    await new Promise((resolve) => monolithServer.close(resolve));
  }
  await stopMemoryMongo();
});

function cleanHeaders(headers) {
  const cleaned = { ...headers };
  const transient = [
    "x-request-id",
    "date",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "content-length",
    "etag",
    "set-cookie" // Cookies can contain dynamically generated IDs/tokens, compared separately
  ];
  transient.forEach((h) => delete cleaned[h]);
  return cleaned;
}

function cleanBody(body) {
  if (!body || typeof body !== "object") return body;
  const cleaned = JSON.parse(JSON.stringify(body));
  const walkAndRemove = (obj) => {
    if (!obj || typeof obj !== "object") return;
    const transientKeys = ["timestamp", "uptimeSec", "requestId", "reqId"];
    for (const key of Object.keys(obj)) {
      if (transientKeys.includes(key)) {
        delete obj[key];
      } else if (typeof obj[key] === "object") {
        walkAndRemove(obj[key]);
      }
    }
  };
  walkAndRemove(cleaned);
  return cleaned;
}

async function compareEndpoint(path) {
  const [monoRes, gateRes] = await Promise.all([
    request(`http://localhost:${monolithPort}`).get(path),
    request(`http://localhost:${gatewayPort}`).get(path)
  ]);

  // Assert status and content-type are identical
  expect(gateRes.status).toBe(monoRes.status);
  expect(gateRes.headers["content-type"]).toBe(monoRes.headers["content-type"]);

  // Assert specific standard API headers match
  const headersToMatch = ["x-api-version", "x-workhub-version"];
  headersToMatch.forEach((h) => {
    if (monoRes.headers[h] || gateRes.headers[h]) {
      expect(gateRes.headers[h]).toBe(monoRes.headers[h]);
    }
  });

  // Verify security headers exist on both (they may differ slightly due to gateway middleware, but key ones should be there)
  expect(gateRes.headers["x-content-type-options"]).toBe("nosniff");
  expect(monoRes.headers["x-content-type-options"]).toBe("nosniff");

  if (!path.includes("/csrf")) {
    expect(cleanBody(gateRes.body)).toEqual(cleanBody(monoRes.body));
  } else {
    // CSRF contains dynamic tokens, just assert shape
    expect(gateRes.body).toHaveProperty("csrfToken");
    expect(monoRes.body).toHaveProperty("csrfToken");
  }
}

describe("API Gateway Contract Comparison", () => {
  test("GET /health is equivalent", async () => {
    await compareEndpoint("/health");
  });

  test("GET /health/ready is equivalent", async () => {
    await compareEndpoint("/health/ready");
  });

  test("GET /status is equivalent", async () => {
    await compareEndpoint("/status");
  });

  test("GET /login is equivalent", async () => {
    await compareEndpoint("/login");
  });

  test("GET /api/auth/csrf is equivalent", async () => {
    await compareEndpoint("/api/auth/csrf");
  });
});
