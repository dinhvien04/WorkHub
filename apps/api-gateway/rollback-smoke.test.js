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

beforeAll(async () => {
  await startMemoryMongo();
  const monolithApp = createApp();
  monolithServer = http.createServer(monolithApp);
  await new Promise((resolve) => monolithServer.listen(0, resolve));
  monolithPort = monolithServer.address().port;
}, 60000);

afterAll(async () => {
  if (monolithServer) {
    await new Promise((resolve) => monolithServer.close(resolve));
  }
  await stopMemoryMongo();
});

describe("Rollback and Canary Smoke Tests", () => {
  test("Direct Monolith access succeeds (Rollback Path)", async () => {
    // Assert that client requests bypass the gateway and interact directly with the legacy monolith successfully
    const res = await request(`http://localhost:${monolithPort}`).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  test("Gateway with CANARY_BYPASS enabled propagates bypass header", async () => {
    let receivedHeaders;
    const mockMonolith = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
    await new Promise((resolve) => mockMonolith.listen(0, resolve));
    const mockPort = mockMonolith.address().port;

    // Set destination config
    process.env.LEGACY_MONOLITH_URL = `http://localhost:${mockPort}`;
    process.env.CANARY_BYPASS = "true";

    await new Promise((resolve) => {
      jest.isolateModules(async () => {
        const { app: gatewayApp } = require("./server");
        const gatewayServer = http.createServer(gatewayApp);
        await new Promise((resListen) => gatewayServer.listen(0, resListen));
        const gatewayPort = gatewayServer.address().port;

        const res = await request(`http://localhost:${gatewayPort}`).get("/health");
        expect(res.status).toBe(200);
        expect(receivedHeaders["x-canary-bypass"]).toBe("true");

        await new Promise((resClose) => gatewayServer.close(resClose));
        await new Promise((monClose) => mockMonolith.close(monClose));
        resolve();
      });
    });
  });
});
