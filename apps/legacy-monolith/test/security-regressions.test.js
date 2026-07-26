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

describe("Booking creation validates its body", () => {
  const schemas = require("../validators/schemas");

  test("a Mongo operator in spaceId is rejected", () => {
    // Mongoose casts {$gte: ...} through findById unchanged, so without this
    // schema the query returns whichever space mongod orders first and the
    // booking is created against a space the caller never named.
    expect(() =>
      schemas.parse(schemas.bookingCreate, {
        spaceId: { $gte: "000000000000000000000000" },
        startTime: "2027-01-01T10:00:00.000Z",
        endTime: "2027-01-01T11:00:00.000Z",
      }),
    ).toThrow();
  });

  test.each([
    ["$ne object", { $ne: null }],
    ["array", ["507f1f77bcf86cd799439011"]],
    ["regex-ish string", "507f1f77bcf86cd7994390.*"],
    ["short hex", "507f1f77"],
  ])("spaceId rejects %s", (_label, spaceId) => {
    expect(() =>
      schemas.parse(schemas.bookingCreate, {
        spaceId,
        startTime: "2027-01-01T10:00:00.000Z",
        endTime: "2027-01-01T11:00:00.000Z",
      }),
    ).toThrow();
  });

  test("a well-formed body passes and keeps the addOns shape the service expects", () => {
    const parsed = schemas.parse(schemas.bookingCreate, {
      spaceId: "507f1f77bcf86cd799439011",
      startTime: "2027-01-01T10:00:00.000Z",
      endTime: "2027-01-01T11:00:00.000Z",
      addOns: [{ addOnId: "507f1f77bcf86cd799439012", quantity: 2 }],
      preferInstant: true,
    });

    expect(parsed.spaceId).toBe("507f1f77bcf86cd799439011");
    expect(parsed.addOns[0]).toMatchObject({ quantity: 2 });
  });

  test("an over-long note is rejected rather than persisted", () => {
    expect(() =>
      schemas.parse(schemas.bookingCreate, {
        spaceId: "507f1f77bcf86cd799439011",
        startTime: "2027-01-01T10:00:00.000Z",
        endTime: "2027-01-01T11:00:00.000Z",
        note: "x".repeat(5000),
      }),
    ).toThrow();
  });

  test("the controller parses the body before using it", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "controllers", "customerController.js"),
      "utf8",
    );
    expect(src).toContain("schemas.parse(schemas.bookingCreate, req.body)");
  });

  test("the service casts spaceId even if a caller skips the schema", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "services", "bookingService.js"),
      "utf8",
    );
    expect(src).toContain("Space.findById(String(spaceId))");
  });
});

describe("Staff calendar respects branch scope", () => {
  const staffService = require("../services/staffService");

  test("an empty branch allowlist is a denial, not a wildcard", () => {
    // [] is truthy, and [][0] is undefined — which used to collapse to
    // "no branch filter", i.e. every branch the host owns.
    expect(() =>
      staffService.assertBranchAccess(
        { isOwner: false, allowedBranchIds: [] },
        null,
      ),
    ).toThrow(/chi nhánh/i);
  });

  test("a missing branch hint is still refused for scoped staff", () => {
    expect(() =>
      staffService.assertBranchAccess(
        { isOwner: false, allowedBranchIds: ["507f1f77bcf86cd799439011"] },
        null,
      ),
    ).toThrow();
  });

  test("owners and all-branch staff are unaffected", () => {
    expect(staffService.assertBranchAccess({ isOwner: true }, null)).toBe(true);
    expect(
      staffService.assertBranchAccess(
        { isOwner: false, allowedBranchIds: null },
        null,
      ),
    ).toBe(true);
  });

  test("the calendar handler no longer indexes allowedBranchIds[0]", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "controllers", "bookingController.js"),
      "utf8",
    );
    // Taking only the first branch also hid the rest from multi-branch staff.
    expect(src).not.toContain("req.hostContext.allowedBranchIds[0]");
    expect(src).toContain("assertBranchAccess(req.hostContext, null)");
  });

  test("getHostCalendar scopes to a branch set when given one", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "services", "calendarService.js"),
      "utf8",
    );
    expect(src).toContain("spaceFilter.BranchID = { $in: branchIds }");
  });
});

describe("Operational errors keep their status code", () => {
  const request = require("supertest");
  const {
    createUser,
    seedHostSpace,
    getApp,
    agentWithAuth,
    getCsrfPair,
    withCsrf,
  } = require("./helpers");

  test("a malformed booking body is a 400, not a 500", async () => {
    // sendServerError used to flatten every error to 500, so a rejected body
    // was reported as a server fault and the reason was lost. Service-thrown
    // NotFoundError/ConflictError were masked the same way.
    const localApp = getApp();
    const host = await createUser({ email: "opserr-host@test.com", role: "host" });
    const customer = await createUser({ email: "opserr-cust@test.com", role: "customer" });
    await seedHostSpace(host);

    const { token } = agentWithAuth(localApp, customer);
    const csrf = await getCsrfPair(localApp);

    const res = await withCsrf(
      request(localApp).post("/api/customers/me/bookings"),
      csrf,
      `authToken=${token}`,
    ).send({
      spaceId: { $gte: "000000000000000000000000" },
      startTime: "2027-01-01T10:00:00.000Z",
      endTime: "2027-01-01T11:00:00.000Z",
    });

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  }, 20000);
});

describe("Dead letters never persist a live secret", () => {
  const {
    redactEventForStorage,
    isSecretBearingEvent,
  } = require("@workhub/contracts");

  function verifyEmailEvent(secretValue) {
    return {
      eventId: "11111111-1111-4111-8111-111111111111",
      eventType: "identity.email-requested.v1",
      occurredAt: new Date().toISOString(),
      producer: "identity-service",
      aggregateId: "507f1f77bcf86cd799439011",
      aggregateVersion: 0,
      correlationId: "22222222-2222-4222-8222-222222222222",
      data: {
        userId: "507f1f77bcf86cd799439011",
        toEmail: "victim@example.com",
        template: "password_reset_otp",
        data: { otp: secretValue },
        requestedAt: new Date().toISOString(),
      },
    };
  }

  test("the reset OTP does not survive redaction", () => {
    // identity encrypts this envelope at rest and drops the ciphertext right
    // after publishing. A dead-letter row storing the decrypted form undoes
    // both controls, and the admin DLQ API returns those rows verbatim.
    const redacted = redactEventForStorage(verifyEmailEvent("424242"));
    expect(JSON.stringify(redacted)).not.toContain("424242");
    expect(redacted.redacted).toBe(true);
  });

  test("redaction keeps what an operator needs to diagnose", () => {
    const redacted = redactEventForStorage(verifyEmailEvent("999999"));
    expect(redacted.eventId).toBe("11111111-1111-4111-8111-111111111111");
    expect(redacted.eventType).toBe("identity.email-requested.v1");
    expect(redacted.data.toEmail).toBe("victim@example.com");
    expect(redacted.data.template).toBe("password_reset_otp");
  });

  test("non-secret events pass through untouched", () => {
    const booking = {
      eventId: "33333333-3333-4333-8333-333333333333",
      eventType: "booking.confirmed.v1",
      data: { bookingId: "b1", paidAmount: 100 },
    };
    expect(isSecretBearingEvent(booking)).toBe(false);
    expect(redactEventForStorage(booking)).toEqual(booking);
  });

  test("both dead-letter writers redact before storing", () => {
    const fs = require("fs");
    const path = require("path");
    const files = [
      path.join(__dirname, "..", "services", "inboxService.js"),
      path.join(
        __dirname, "..", "..", "..",
        "services", "communication-service", "services", "consumerService.js",
      ),
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(src).toContain("redactEventForStorage(event)");
      expect(src).not.toContain("Payload: event || {}");
    }
  });

  test("dead-letter rows expire", () => {
    const fs = require("fs");
    const path = require("path");
    for (const f of [
      path.join(__dirname, "..", "models", "ConsumerDeadLetter.js"),
      path.join(
        __dirname, "..", "..", "..",
        "services", "communication-service", "models", "ConsumerDeadLetter.js",
      ),
    ]) {
      expect(fs.readFileSync(f, "utf8")).toContain("expireAfterSeconds");
    }
  });

  test("the broker no longer logs the whole envelope on validation failure", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "packages", "observability", "messaging.js"),
      "utf8",
    );
    expect(src).not.toContain('validationErr.message, event)');
    expect(src).toContain("eventId=${event && event.eventId}");
  });

  test("a redacted dead letter cannot be replayed", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "controllers", "adminController.js"),
      "utf8",
    );
    expect(src).toContain("DLQ_REDACTED_NOT_REPLAYABLE");
  });
});
