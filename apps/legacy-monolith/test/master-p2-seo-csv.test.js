"use strict";

const { escapeCsv, ledgerToCsv } = require("../services/exportService");
const { isSafeInternalPath, publicBaseUrl } = require("../utils/publicBaseUrl");
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  getApp,
  agentWithAuth,
  getCsrfPair,
  withCsrf,
} = require("./helpers");
const request = require("supertest");

let app;

beforeAll(async () => {
  await startMemoryMongo();
  app = getApp();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearDb();
});

describe("P2 CSV formula injection", () => {
  test("cells starting with = + - @ are neutralized", () => {
    expect(escapeCsv("=CMD()")).toMatch(/^'/);
    expect(escapeCsv("+1+1")).toMatch(/^'/);
    expect(escapeCsv("-1+1")).toMatch(/^'/);
    expect(escapeCsv("@SUM(A1)")).toMatch(/^'/);
    expect(escapeCsv("normal")).toBe("normal");
    const csv = ledgerToCsv([
      {
        createdAt: new Date(),
        Type: "payment",
        Direction: "credit",
        Amount: 1,
        Description: "=HYPERLINK()",
        IdempotencyKey: "k",
      },
    ]);
    expect(csv).toContain("'=HYPERLINK()");
  });
});

describe("P2 SEO redirect safety", () => {
  test("isSafeInternalPath rejects external and protocol-relative", () => {
    expect(isSafeInternalPath("/ok/path")).toBe(true);
    expect(isSafeInternalPath("//evil.com")).toBe(false);
    expect(isSafeInternalPath("https://evil.com")).toBe(false);
    expect(isSafeInternalPath("javascript:alert(1)")).toBe(false);
  });

  test("admin cannot create open redirect", async () => {
    const admin = await createUser({ email: "seoad@t.com", role: "admin" });
    const { token } = agentWithAuth(app, admin);
    const csrf = await getCsrfPair(app);
    const bad = await withCsrf(
      request(app).put("/api/admin/seo/redirects"),
      csrf,
      `authToken=${token}`,
    ).send({ fromPath: "/a", toPath: "//evil.com" });
    expect(bad.status).toBe(400);

    const ok = await withCsrf(
      request(app).put("/api/admin/seo/redirects"),
      csrf,
      `authToken=${token}`,
    ).send({ fromPath: "/old", toPath: "/new" });
    expect([200, 201]).toContain(ok.status);
  });
});

describe("P2 publicBaseUrl", () => {
  test("prefers PUBLIC_BASE_URL when set", () => {
    const env = require("../config/env");
    const prev = env.PUBLIC_BASE_URL;
    env.PUBLIC_BASE_URL = "https://workhub.example";
    expect(publicBaseUrl(null)).toBe("https://workhub.example");
    env.PUBLIC_BASE_URL = prev;
  });
});
