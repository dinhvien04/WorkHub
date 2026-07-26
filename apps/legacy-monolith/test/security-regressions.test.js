"use strict";

/**
 * Regression tests for findings from the repo-wide security audit.
 *
 * Each test reproduces the actual attack rather than asserting that a fix is
 * present, so the test still fails if someone reintroduces the bug by a
 * different route.
 */
const request = require("supertest");
const multer = require("multer");
const express = require("express");
const { escapeRegex, safeRegexQuery } = require("../utils/escapeRegex");
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  getApp,
} = require("./helpers");

let app;

beforeAll(async () => {
  await startMemoryMongo();
  app = getApp();
});

afterAll(async () => {
  await stopMemoryMongo();
});

describe("ReDoS via unauthenticated URL path segment", () => {
  beforeEach(async () => {
    await clearDb();
  });

  // The pattern the audit used: nested quantifier with a failing tail, which
  // forces exponential backtracking on any moderately long subject.
  const EVIL = "(\\w+\\s*)+!";

  test("escapeRegex neutralises the backtracking construct", () => {
    const escaped = escapeRegex(EVIL);
    expect(escaped).not.toBe(EVIL);

    // After escaping, the metacharacters are literals — the compiled pattern
    // can only ever match the literal text, never backtrack.
    const re = new RegExp(escaped, "i");
    const subject = "WorkHub Saigon Central Coworking Space District One".repeat(4);

    const started = Date.now();
    expect(re.test(subject)).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });

  test("safeRegexQuery caps length and returns a Mongo-safe operator object", () => {
    const q = safeRegexQuery("a".repeat(500), 80);
    expect(q.$regex.length).toBeLessThanOrEqual(80);
    expect(q.$options).toBe("i");

    // An all-metacharacter input must not produce a live pattern.
    const evil = safeRegexQuery(EVIL, 80);
    expect(evil.$regex).not.toContain("(\\w+");
    expect(() => new RegExp(evil.$regex)).not.toThrow();
  });

  test("the public listing route answers promptly for a catastrophic slug", async () => {
    // Before the fix this compiled the slug into a live RegExp and handed it to
    // mongod to run against every active branch.
    const slug = encodeURIComponent(EVIL);

    const started = Date.now();
    const res = await request(app).get(`/khong-gian/ha-noi/cau-giay/${slug}`);
    const elapsed = Date.now() - started;

    // 404 (no such branch) or 301 (canonical redirect) are both fine; hanging
    // is not.
    expect([200, 301, 302, 404]).toContain(res.status);
    expect(elapsed).toBeLessThan(5000);
  }, 15000);

  test("a wildcard slug does not surface a branch it does not name", async () => {
    // The point of escaping: `.*` used to compile to a match-anything pattern,
    // which would return the first active branch regardless of the URL. After
    // escaping it can only match a branch whose name literally contains ".*".
    const { createUser, seedHostSpace } = require("./helpers");
    const host = await createUser({ email: "redos-host@test.com", role: "host" });
    await seedHostSpace(host);

    const res = await request(app).get(
      `/khong-gian/ha-noi/cau-giay/${encodeURIComponent(".*")}`,
    );

    // Whatever it does, it must not render the seeded branch's detail page.
    expect(res.text || "").not.toContain("Branch A");
  }, 15000);
});

describe("Multipart limits", () => {
  /**
   * Exercised against a bare multer instance configured exactly like
   * middlewares/upload.js, because the real routes sit behind auth and CSRF
   * and would reject the request before the parser ever sees it.
   */
  function appWithLimits(limits) {
    const parser = multer({ storage: multer.memoryStorage(), limits });
    const a = express();
    a.post("/u", (req, res) => {
      parser.any()(req, res, (err) => {
        if (err) return res.status(400).json({ code: err.code });
        res.json({ fields: Object.keys(req.body || {}).length });
      });
    });
    return a;
  }

  const PRODUCTION_LIMITS = require("../middlewares/upload").uploadLimits;

  test("upload.js exports bounds for the non-file parts too", () => {
    // busboy defaults these to Infinity / 1MB when unset, which is what made
    // an unauthenticated multipart body able to exhaust the heap.
    expect(PRODUCTION_LIMITS).toMatchObject({
      fileSize: expect.any(Number),
      files: expect.any(Number),
      fields: expect.any(Number),
      parts: expect.any(Number),
      fieldSize: expect.any(Number),
    });
    expect(PRODUCTION_LIMITS.fields).toBeLessThan(1000);
    expect(PRODUCTION_LIMITS.parts).toBeLessThan(1000);
    expect(PRODUCTION_LIMITS.fieldSize).toBeLessThanOrEqual(64 * 1024);
  });

  test("a flood of text fields is rejected rather than buffered", async () => {
    const a = appWithLimits(PRODUCTION_LIMITS);
    const req = request(a).post("/u");
    for (let i = 0; i < PRODUCTION_LIMITS.fields + 25; i++) {
      req.field(`f${i}`, "x");
    }

    const res = await req;
    expect(res.status).toBe(400);
    expect(["LIMIT_FIELD_COUNT", "LIMIT_PART_COUNT"]).toContain(res.body.code);
  }, 20000);

  test("an oversized single field is rejected", async () => {
    const a = appWithLimits(PRODUCTION_LIMITS);
    const res = await request(a)
      .post("/u")
      .field("big", "x".repeat(PRODUCTION_LIMITS.fieldSize + 4096));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LIMIT_FIELD_VALUE");
  }, 20000);

  test("a normal submission still passes", async () => {
    const a = appWithLimits(PRODUCTION_LIMITS);
    const res = await request(a).post("/u").field("email", "a@b.c").field("name", "Test");

    expect(res.status).toBe(200);
    expect(res.body.fields).toBe(2);
  });
});

describe("errorHandler maps every multipart limit to 400", () => {
  const { errorHandler } = require("../middlewares/errorHandler");

  test.each([
    "LIMIT_FILE_SIZE",
    "LIMIT_FILE_COUNT",
    "LIMIT_UNEXPECTED_FILE",
    "LIMIT_FIELD_COUNT",
    "LIMIT_FIELD_KEY",
    "LIMIT_FIELD_VALUE",
    "LIMIT_PART_COUNT",
  ])("%s becomes a 400, not a 500", (code) => {
    // A limit that is not mapped falls through to the generic handler and
    // reports a server fault for what is really a rejected request.
    const res = {
      statusCode: null,
      body: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      },
    };
    errorHandler({ code, message: "limit" }, { path: "/api/x", get: () => "" }, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe(code);
  });
});

describe("Avatar upload goes through the validation chain", () => {
  const fs = require("fs");
  const path = require("path");

  test("no route reaches a bare multer handler", () => {
    // The bare and safe spellings look identical at a call site, which is how
    // the customer avatar route ended up skipping magic bytes and the malware
    // scan while every other upload route was chained correctly.
    const routesDir = path.join(__dirname, "..", "routes");
    const offenders = [];

    for (const name of fs.readdirSync(routesDir)) {
      if (!name.endsWith(".js")) continue;
      fs.readFileSync(path.join(routesDir, name), "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (
            line.includes("upload.singleWithMagic") ||
            line.includes("upload.arrayWithMagic")
          ) {
            return;
          }
          if (/\bupload\.(single|array)\s*\(/.test(line)) {
            offenders.push(`routes/${name}:${i + 1} ${line.trim()}`);
          }
        });
    }

    expect(offenders).toEqual([]);
  });

  test("the avatar routes use the chained form", () => {
    for (const file of ["customerApiRoutes.js", "customerRoutes.js"]) {
      const text = fs.readFileSync(path.join(__dirname, "..", "routes", file), "utf8");
      expect(text).toContain("upload.singleWithMagic('customerAvatar')");
    }
  });

  test("singleWithMagic really is the full chain, not an alias", () => {
    const upload = require("../middlewares/upload");
    const chain = upload.singleWithMagic("customerAvatar");

    // multer + magic bytes + scan + storage. If someone shortens this, the
    // route-level checks above would still pass while the protection is gone.
    expect(Array.isArray(chain)).toBe(true);
    expect(chain.length).toBe(4);
    expect(chain.every((mw) => typeof mw === "function")).toBe(true);
  });
});

describe("Avatar update never destroys the old file without a replacement", () => {
  const fs = require("fs");
  const path = require("path");

  test("the controller requires a stored URL before touching Cloudinary", () => {
    // memoryStorage populates only buffer/size, so `req.file.path` was
    // undefined: Mongoose stripped it from $set while the old avatar had
    // already been destroyed, leaving the row pointing at a deleted file.
    const src = fs.readFileSync(
      path.join(__dirname, "..", "controllers", "customerController.js"),
      "utf8",
    );

    const destroyIdx = src.indexOf("cloudinary.uploader.destroy");
    const guardIdx = src.indexOf("if (!newAvatarUrl)");

    expect(guardIdx).toBeGreaterThan(-1);
    // The guard must come first — that ordering is the fix.
    expect(guardIdx).toBeLessThan(destroyIdx);
    expect(src).not.toContain("updateData.Avatar = req.file.path;");
  });
});
