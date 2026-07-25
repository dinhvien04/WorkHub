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
});
