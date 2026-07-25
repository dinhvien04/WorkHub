"use strict";

const request = require("supertest");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const { app, server: gatewayServer } = require("./server");

let mockMonolithServer;
let mockWss;
let gatewayPort;
let targetPort = 3001;

beforeAll((done) => {
  // Start a mock monolith HTTP server on port 3001
  const mockApp = express();
  mockApp.get("/api/test-proxy", (req, res) => {
    res.json({
      status: "monolith_ok",
      forwardedRequestId: req.headers["x-request-id"],
    });
  });
  mockMonolithServer = http.createServer(mockApp);

  // Set up mock WebSocket server on monolith
  mockWss = new WebSocket.Server({ server: mockMonolithServer });
  mockWss.on("connection", (ws) => {
    ws.on("message", (msg) => {
      ws.send(`echo: ${msg}`);
    });
  });

  mockMonolithServer.listen(targetPort, () => {
    // Also start gateway server on an ephemeral port
    gatewayServer.listen(0, () => {
      gatewayPort = gatewayServer.address().port;
      done();
    });
  });
});

afterAll((done) => {
  // Close mock wss and monolith
  if (mockWss) {
    mockWss.close(() => {
      if (mockMonolithServer) {
        mockMonolithServer.close(() => {
          // Close gateway server
          if (gatewayServer) {
            gatewayServer.close(() => {
              done();
            });
          } else {
            done();
          }
        });
      } else {
        done();
      }
    });
  } else {
    done();
  }
});

describe("API Gateway Proxy & Middleware Tests", () => {
  test("GET /gateway/health returns gateway health metrics", async () => {
    const res = await request(app).get("/gateway/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.gateway).toBe(true);
  });

  test("Proxy forwards WebSocket upgrades to monolith", (done) => {
    const wsClient = new WebSocket(`ws://localhost:${gatewayPort}/`);
    wsClient.on("open", () => {
      wsClient.send("hello");
    });
    wsClient.on("message", (data) => {
      expect(data.toString()).toBe("echo: hello");
      wsClient.close();
      done();
    });
    wsClient.on("error", done);
  });

  test("Proxy propagates request ID and forwards traffic to monolith", async () => {
    const res = await request(app)
      .get("/api/test-proxy")
      .set("X-Request-Id", "custom-req-id-123");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("monolith_ok");
    expect(res.body.forwardedRequestId).toBe("custom-req-id-123");
    expect(res.headers["x-request-id"]).toBe("custom-req-id-123");
  });

  test("Proxy generates a Request ID if not provided by client", async () => {
    const res = await request(app).get("/api/test-proxy");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("monolith_ok");
    expect(res.body.forwardedRequestId).toBeTruthy();
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  test("Gateway returns 502/504 when monolith is down", async () => {
    // Stop the mock monolith temporarily
    await new Promise((resolve) => mockMonolithServer.close(() => resolve()));

    const res = await request(app).get("/api/test-proxy");
    expect([502, 504]).toContain(res.status);
    expect(["Bad Gateway", "Gateway Timeout"]).toContain(res.body.error);

    // Restart mock monolith for clean teardown
    await new Promise((resolve) => {
      mockMonolithServer.listen(targetPort, () => resolve());
    });
  });

  test("CORS allows requests from allowed origins", async () => {
    const res = await request(app)
      .get("/gateway/health")
      .set("Origin", "http://localhost:3000");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["vary"]).toContain("Origin");
  });

  test("CORS rejects requests from disallowed origins", async () => {
    const res = await request(app)
      .get("/gateway/health")
      .set("Origin", "http://malicious.com");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden by CORS" });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("Proxy pathing E2E: target content server receives original intact URL path", async () => {
    let receivedUrl;
    let receivedHeaders;
    const mockContentServer = http.createServer((req, res) => {
      receivedUrl = req.url;
      receivedHeaders = req.headers;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "content_ok" }));
    });
    await new Promise((resolve) => mockContentServer.listen(0, resolve));
    const mockPort = mockContentServer.address().port;

    // Isolate modules to re-require server with new environment variables
    await new Promise((resolve, reject) => {
      jest.isolateModules(async () => {
        try {
          process.env.CONTENT_SERVICE_URL = `http://localhost:${mockPort}`;
          process.env.CONTENT_SERVICE_ENABLED = "true";
          process.env.CONTENT_CANARY_PERCENT = "100";
          process.env.CONTENT_INTERNAL_SECRET = "test_content_internal_secret";

          const { app: tempGatewayApp } = require("./server");
          const res = await request(tempGatewayApp)
            .get("/api/content/pages/about-us")
            .set("Origin", "http://localhost:3000");

          expect(res.status).toBe(200);
          expect(res.body.status).toBe("content_ok");
          // The target server MUST receive the original path intact, not stripped
          expect(receivedUrl).toBe("/api/content/pages/about-us");
          expect(receivedHeaders["x-internal-token"]).toBe("test_content_internal_secret");

          await new Promise((resClose) => mockContentServer.close(resClose));
          resolve();
        } catch (err) {
          await new Promise((resClose) => mockContentServer.close(resClose));
          reject(err);
        }
      });
    });
  });

  test("Canary routing hash distribution and determinism on 100,000 identifiers", () => {
    const { shouldRouteToContent } = require("./server");

    // Enable content service
    process.env.CONTENT_SERVICE_ENABLED = "true";

    const testCanaryPercentage = (percent) => {
      process.env.CONTENT_CANARY_PERCENT = String(percent);
      let routedCount = 0;
      const count = 100000;

      // 1. Determinism check
      const sampleReq = { user: { userId: "user-test-123" } };
      const firstResult = shouldRouteToContent(sampleReq);
      for (let i = 0; i < 10; i++) {
        expect(shouldRouteToContent(sampleReq)).toBe(firstResult);
      }

      // 2. Uniform distribution check
      for (let i = 0; i < count; i++) {
        const req = { user: { userId: `user-${i}` } };
        if (shouldRouteToContent(req)) {
          routedCount++;
        }
      }

      const actualPercent = (routedCount / count) * 100;
      // Allow minor tolerance (e.g. within 1.5% absolute deviation)
      if (percent === 0) {
        expect(routedCount).toBe(0);
      } else if (percent === 100) {
        expect(routedCount).toBe(count);
      } else {
        const diff = Math.abs(actualPercent - percent);
        expect(diff).toBeLessThan(1.5); // Within 1.5% tolerance limit
      }
    };

    testCanaryPercentage(0);
    testCanaryPercentage(1);
    testCanaryPercentage(10);
    testCanaryPercentage(50);
    testCanaryPercentage(100);
  });
});
