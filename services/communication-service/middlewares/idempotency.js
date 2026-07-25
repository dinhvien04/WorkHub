"use strict";

const crypto = require("crypto");
const IdempotencyRecord = require("../models/IdempotencyRecord");

function idempotency() {
  return async (req, res, next) => {
    // Only apply to mutating HTTP methods
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return next();
    }

    const clientKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    if (!clientKey) return next();

    // Validate key length and control chars
    if (clientKey.length > 256 || /[\x00-\x1F\x7F]/.test(clientKey)) {
      return res.status(400).json({ error: "Idempotency-Key không hợp lệ hoặc quá dài." });
    }

    const actorId = req.user ? (req.user.userId || req.user.id || "anonymous") : "anonymous";
    const method = req.method;
    const route = req.path;
    const normalizedKey = clientKey.trim();

    // Hash client key to prevent database storage abuse
    const clientKeyHash = crypto.createHash("sha256").update(normalizedKey).digest("hex");
    const scopeKey = `${actorId}:${method}:${route}:${clientKeyHash}`;
    const requestFingerprint = crypto.createHash("sha256").update(JSON.stringify(req.body || {})).digest("hex");

    try {
      // Attempt to acquire lock / create record
      await IdempotencyRecord.create({
        ScopeKey: scopeKey,
        RequestFingerprint: requestFingerprint,
        Status: "pending",
        ResponseStatus: 200,
        ResponseBody: {},
        ExpiresAt: new Date(Date.now() + 24 * 3600 * 1000), // 24 hours TTL
      });

      // We are the winner! Override res.send to save response upon completion
      const originalSend = res.send;
      res.send = function (body) {
        res.send = originalSend;

        let responseBody = body;
        try {
          responseBody = JSON.parse(body);
        } catch (_) {
          // keep as raw string if not JSON
        }

        // Save result
        IdempotencyRecord.updateOne(
          { ScopeKey: scopeKey },
          {
            $set: {
              Status: "completed",
              ResponseStatus: res.statusCode,
              ResponseBody: responseBody,
            }
          }
        ).catch(console.error);

        return originalSend.apply(res, arguments);
      };

      return next();
    } catch (err) {
      if (err.code === 11000 || (err.writeErrors && err.writeErrors.some(e => e.code === 11000))) {
        // Record already exists. Query it.
        let existing = await IdempotencyRecord.findOne({ ScopeKey: scopeKey });
        if (!existing) return next(err);

        // Check fingerprint conflict
        if (existing.RequestFingerprint !== requestFingerprint) {
          return res.status(409).json({
            error: "Idempotency key already used with a different payload.",
            code: "IDEMPOTENCY_KEY_REUSED"
          });
        }

        // Poll if pending (concurrent duplicate resolution)
        if (existing.Status === "pending") {
          for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            existing = await IdempotencyRecord.findOne({ ScopeKey: scopeKey });
            if (existing && existing.Status === "completed") {
              break;
            }
          }
          if (existing.Status === "pending") {
            return res.status(409).json({ error: "Một yêu cầu trùng lặp đang được xử lý." });
          }
        }

        // Return cached response
        res.status(existing.ResponseStatus);
        return res.json(existing.ResponseBody);
      }
      return next(err);
    }
  };
}

module.exports = idempotency;
