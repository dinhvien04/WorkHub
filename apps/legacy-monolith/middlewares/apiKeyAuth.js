"use strict";

const crypto = require("crypto");
const ApiKey = require("../models/ApiKey");
const { UnauthorizedError, ForbiddenError } = require("../utils/errors");

async function requireApiKey(req, res, next) {
  try {
    const header = req.get("x-api-key") || req.get("authorization");
    let raw = null;
    if (header?.startsWith("Bearer wh_")) raw = header.slice(7).trim();
    else if (header?.startsWith("wh_")) raw = header.trim();
    else if (req.get("x-api-key")) raw = req.get("x-api-key").trim();

    if (!raw || !raw.startsWith("wh_")) {
      return next(new UnauthorizedError("Missing API key."));
    }

    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const prefix = raw.slice(0, 10);
    const key = await ApiKey.findOne({
      KeyPrefix: prefix,
      KeyHash: hash,
      Status: "active",
    });
    if (!key) return next(new UnauthorizedError("Invalid API key."));
    if (key.ExpiresAt && key.ExpiresAt < new Date()) {
      return next(new ForbiddenError("API key expired."));
    }
    // Throttle LastUsedAt writes (once per 60s) — avoid write-per-request load
    const last = key.LastUsedAt ? new Date(key.LastUsedAt).getTime() : 0;
    if (Date.now() - last > 60_000) {
      await ApiKey.updateOne(
        { _id: key._id },
        { $set: { LastUsedAt: new Date() } },
      );
    }
    req.apiKey = key;
    req.partnerUserId = key.OwnerUserID;
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireScope(scope) {
  return (req, res, next) => {
    const scopes = req.apiKey?.Scopes || [];
    if (!scopes.includes(scope) && !scopes.includes("*")) {
      return next(new ForbiddenError(`Missing scope: ${scope}`));
    }
    return next();
  };
}

module.exports = { requireApiKey, requireScope };
