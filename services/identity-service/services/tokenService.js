"use strict";

/**
 * Token issuing and validation, with one function per token type.
 *
 * The three types below are deliberately not interchangeable: they use
 * different keys, issuers, audiences and `typ` headers, so a token minted for
 * one purpose cannot be replayed against another. A single permissive
 * `jwt.verify` is what previously let a 5-minute pre-auth 2FA token be signed
 * with the same secret as a full access token.
 *
 *   1. RS256 access token   — iss workhub-identity, aud workhub-api-gateway, typ at+jwt
 *   2. Legacy HS256 access  — iss workhub-auth,     aud workhub-app,         sunset-gated
 *   3. Pre-auth 2FA token   — iss workhub-identity, aud workhub-2fa,         typ workhub-preauth-2fa+jwt
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const keyManager = require("./keyManager");
const PendingAuthToken = require("../models/PendingAuthToken");

const ACCESS_ISSUER = "workhub-identity";
const ACCESS_AUDIENCE = "workhub-api-gateway";
const ACCESS_TYP = "at+jwt";

const LEGACY_ISSUER = "workhub-auth";
const LEGACY_AUDIENCE = "workhub-app";

const PREAUTH_ISSUER = "workhub-identity";
const PREAUTH_AUDIENCE = "workhub-2fa";
const PREAUTH_TYP = "workhub-preauth-2fa+jwt";
const PREAUTH_MAX_AGE_SECONDS = 300;

class TokenError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "TokenError";
    this.reason = reason;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function decodeHeader(token) {
  try {
    return jwt.decode(token, { complete: true })?.header || null;
  } catch {
    return null;
  }
}

// —— 1. RS256 access token ——

function signAccessToken(user, { sid } = {}) {
  const key = keyManager.getActiveKey();
  const payload = {
    sub: user._id.toString(),
    role: user.Role,
    tokenVersion: user.tokenVersion || 0,
    jti: crypto.randomUUID(),
  };
  if (sid) payload.sid = String(sid);

  return jwt.sign(payload, key.privateKey, {
    algorithm: "RS256",
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: ACCESS_ISSUER,
    audience: ACCESS_AUDIENCE,
    header: { kid: key.kid, typ: ACCESS_TYP },
  });
}

/**
 * Verify an identity-issued RS256 access token.
 *
 * Only checks the token's own integrity and claims — the caller still has to
 * confirm the user status, tokenVersion and session against the database.
 */
function verifyAccessToken(token) {
  const header = decodeHeader(token);
  if (!header) throw new TokenError("Token is not a readable JWT.", "malformed");
  if (header.alg !== "RS256") {
    throw new TokenError(`Access token must use RS256, got "${header.alg}".`, "alg");
  }
  if (header.typ && header.typ !== ACCESS_TYP && header.typ !== "JWT") {
    throw new TokenError(`Unexpected access token typ "${header.typ}".`, "typ");
  }

  const key = keyManager.getVerificationKey(header.kid);

  let decoded;
  try {
    decoded = jwt.verify(token, key.publicKey, {
      algorithms: ["RS256"],
      issuer: ACCESS_ISSUER,
      audience: ACCESS_AUDIENCE,
    });
  } catch (err) {
    throw new TokenError(err.message, "verify");
  }

  if (!decoded.sub) throw new TokenError("Access token is missing sub.", "sub");
  if (!decoded.jti) throw new TokenError("Access token is missing jti.", "jti");
  if (typeof decoded.tokenVersion !== "number") {
    throw new TokenError("Access token is missing tokenVersion.", "tokenVersion");
  }

  return {
    userId: String(decoded.sub),
    role: decoded.role,
    sid: decoded.sid || null,
    jti: decoded.jti,
    tokenVersion: decoded.tokenVersion,
    kid: header.kid || null,
  };
}

// —— 2. Legacy HS256 access token ——

function legacyDeadline() {
  const raw = env.IDENTITY_LEGACY_JWT_DEADLINE;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Whether monolith-issued HS256 tokens are still honoured.
 *
 * Disabled outright by IDENTITY_LEGACY_JWT_ENABLED=false, and automatically
 * once IDENTITY_LEGACY_JWT_DEADLINE has passed — the cutover does not depend
 * on somebody remembering to flip the flag.
 */
function legacyJwtAllowed(now = new Date()) {
  if (!env.IDENTITY_LEGACY_JWT_ENABLED) return false;
  const deadline = legacyDeadline();
  if (deadline && now >= deadline) return false;
  return true;
}

function verifyLegacyAccessToken(token, { now = new Date() } = {}) {
  if (!legacyJwtAllowed(now)) {
    throw new TokenError("Legacy HS256 tokens are no longer accepted.", "legacy_disabled");
  }

  const header = decodeHeader(token);
  if (!header) throw new TokenError("Token is not a readable JWT.", "malformed");
  if (header.alg !== "HS256") {
    throw new TokenError(`Legacy token must use HS256, got "${header.alg}".`, "alg");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: LEGACY_ISSUER,
      audience: LEGACY_AUDIENCE,
    });
  } catch (err) {
    throw new TokenError(err.message, "verify");
  }

  const userId = decoded.userId || decoded.id || decoded._id || decoded.sub;
  if (!userId) throw new TokenError("Legacy token is missing a user id.", "sub");

  return {
    userId: String(userId),
    role: decoded.role,
    sid: decoded.sid || null,
    jti: decoded.jti || null,
    tokenVersion: typeof decoded.tokenVersion === "number" ? decoded.tokenVersion : 0,
    legacy: true,
  };
}

// —— 3. Pre-auth 2FA token ——

function preauthSecret() {
  const secret = env.IDENTITY_PREAUTH_JWT_SECRET;
  if (!secret) {
    throw new TokenError(
      "IDENTITY_PREAUTH_JWT_SECRET is not configured.",
      "preauth_key_missing",
    );
  }
  return secret;
}

/**
 * Issue a step-up token and its single-use database record.
 *
 * Both must exist for the token to be usable, and the record is written before
 * the token reaches the client so a crash cannot leave a usable token with no
 * consumption ledger.
 */
async function issuePreAuthToken(user, { authMethod = "password", req = null } = {}) {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PREAUTH_MAX_AGE_SECONDS * 1000);

  await PendingAuthToken.create({
    JtiHash: sha256(jti),
    UserID: user._id,
    Purpose: "2fa",
    TokenVersion: user.tokenVersion || 0,
    AuthMethod: authMethod,
    IP: req ? String(req.ip || "").slice(0, 64) : "",
    UserAgent: req ? String(req.get("user-agent") || "").slice(0, 300) : "",
    ExpiresAt: expiresAt,
  });

  const token = jwt.sign(
    {
      sub: user._id.toString(),
      purpose: "2fa",
      tokenVersion: user.tokenVersion || 0,
      jti,
    },
    preauthSecret(),
    {
      algorithm: "HS256",
      expiresIn: PREAUTH_MAX_AGE_SECONDS,
      issuer: PREAUTH_ISSUER,
      audience: PREAUTH_AUDIENCE,
      header: { typ: PREAUTH_TYP },
    },
  );

  return { token, jti, expiresAt };
}

/**
 * Validate a pre-auth token's claims. Does not consume it.
 */
function verifyPreAuthToken(token) {
  const header = decodeHeader(token);
  if (!header) throw new TokenError("Token is not a readable JWT.", "malformed");
  if (header.alg !== "HS256") {
    throw new TokenError(`Pre-auth token must use HS256, got "${header.alg}".`, "alg");
  }
  if (header.typ !== PREAUTH_TYP) {
    throw new TokenError(
      `Pre-auth token must carry typ "${PREAUTH_TYP}", got "${header.typ}".`,
      "typ",
    );
  }

  let decoded;
  try {
    decoded = jwt.verify(token, preauthSecret(), {
      algorithms: ["HS256"],
      issuer: PREAUTH_ISSUER,
      audience: PREAUTH_AUDIENCE,
      maxAge: PREAUTH_MAX_AGE_SECONDS,
    });
  } catch (err) {
    throw new TokenError(err.message, "verify");
  }

  if (decoded.purpose !== "2fa") {
    throw new TokenError("Pre-auth token has the wrong purpose.", "purpose");
  }
  if (!decoded.sub) throw new TokenError("Pre-auth token is missing sub.", "sub");
  if (!decoded.jti) throw new TokenError("Pre-auth token is missing jti.", "jti");
  if (typeof decoded.tokenVersion !== "number") {
    throw new TokenError("Pre-auth token is missing tokenVersion.", "tokenVersion");
  }

  return {
    userId: String(decoded.sub),
    jti: decoded.jti,
    tokenVersion: decoded.tokenVersion,
  };
}

/**
 * Atomically spend a pre-auth token.
 *
 * The conditional update is the replay guard: the second caller to present the
 * same jti matches no unconsumed row and gets ok:false.
 */
async function consumePreAuthToken(jti, { session } = {}) {
  const opts = { new: true };
  if (session) opts.session = session;

  const consumed = await PendingAuthToken.findOneAndUpdate(
    {
      JtiHash: sha256(jti),
      Purpose: "2fa",
      ConsumedAt: null,
      ExpiresAt: { $gt: new Date() },
    },
    { $set: { ConsumedAt: new Date() } },
    opts,
  );

  if (!consumed) return { ok: false };
  return { ok: true, record: consumed };
}

/** Invalidate any outstanding step-up tokens for a user. */
async function revokePreAuthTokensForUser(userId, { session } = {}) {
  const opts = session ? { session } : {};
  return PendingAuthToken.updateMany(
    { UserID: userId, ConsumedAt: null },
    { $set: { ConsumedAt: new Date() } },
    opts,
  );
}

module.exports = {
  TokenError,
  ACCESS_ISSUER,
  ACCESS_AUDIENCE,
  ACCESS_TYP,
  LEGACY_ISSUER,
  LEGACY_AUDIENCE,
  PREAUTH_ISSUER,
  PREAUTH_AUDIENCE,
  PREAUTH_TYP,
  PREAUTH_MAX_AGE_SECONDS,
  signAccessToken,
  verifyAccessToken,
  verifyLegacyAccessToken,
  legacyJwtAllowed,
  legacyDeadline,
  issuePreAuthToken,
  verifyPreAuthToken,
  consumePreAuthToken,
  revokePreAuthTokensForUser,
  sha256,
};
