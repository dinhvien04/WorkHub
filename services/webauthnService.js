"use strict";

/**
 * WebAuthn / passkey — fail closed unless WEBAUTHN_ENABLED=true.
 * Registration requires full attestation; no publicKey fallback.
 * Challenges stored as hash only; consumed atomically.
 */
const crypto = require("crypto");
const WebAuthnCredential = require("../models/WebAuthnCredential");
const WebAuthnChallenge = require("../models/WebAuthnChallenge");
const User = require("../models/User");
const env = require("../config/env");
const {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
} = require("../utils/errors");

function assertEnabled() {
  if (!env.WEBAUTHN_ENABLED) {
    const err = new Error("Passkey/WebAuthn is disabled.");
    err.statusCode = 503;
    err.code = "FEATURE_DISABLED";
    err.isOperational = true;
    throw err;
  }
}

function isEnabled() {
  return Boolean(env.WEBAUTHN_ENABLED);
}

function rpIdFromHost(host) {
  if (env.WEBAUTHN_RP_ID) return env.WEBAUTHN_RP_ID;
  if (!host) return "localhost";
  return String(host).split(":")[0];
}

function expectedOrigin() {
  return env.WEBAUTHN_ORIGIN || env.PUBLIC_BASE_URL || "http://localhost:3000";
}

/** Production / finance policy: required; otherwise preferred unless env overrides. */
function userVerificationRequirement(strictRole = false) {
  const raw = String(
    process.env.WEBAUTHN_USER_VERIFICATION ||
      (env.isProduction || strictRole ? "required" : "preferred"),
  ).toLowerCase();
  if (raw === "required" || raw === "preferred" || raw === "discouraged") {
    return raw;
  }
  return env.isProduction ? "required" : "preferred";
}

function requireUserVerification(strictRole = false) {
  return userVerificationRequirement(strictRole) === "required";
}

function randomChallenge() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashChallenge(challenge) {
  return crypto.createHash("sha256").update(String(challenge)).digest("hex");
}

/**
 * Issue challenge: store only ChallengeHash (no long-lived plaintext).
 * Challenge plaintext returned to client only.
 */
async function issueChallenge({ userId = null, purpose, host }) {
  assertEnabled();
  const challenge = randomChallenge();
  const challengeHash = hashChallenge(challenge);
  await WebAuthnChallenge.create({
    UserID: userId,
    Challenge: challengeHash, // unique key — store hash only as Challenge field
    ChallengeHash: challengeHash,
    Purpose: purpose,
    ExpectedRpId: rpIdFromHost(host),
    ExpectedOrigin: expectedOrigin(),
    ExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return challenge;
}

/**
 * Atomically claim challenge by hash before verify completes, or after verify
 * when claimAfterVerify is used. Concurrent replay: only one winner.
 */
async function claimChallengeByHash({
  challenge,
  purpose,
  userId = null,
  markConsumed = true,
}) {
  assertEnabled();
  const challengeHash = hashChallenge(challenge);
  const q = {
    ChallengeHash: challengeHash,
    Purpose: purpose,
    ConsumedAt: null,
    ExpiresAt: { $gt: new Date() },
  };
  if (userId) q.UserID = userId;

  if (!markConsumed) {
    const doc = await WebAuthnChallenge.findOne(q);
    if (!doc) {
      throw new ValidationError(
        "Challenge WebAuthn không hợp lệ hoặc hết hạn.",
      );
    }
    return doc;
  }

  const doc = await WebAuthnChallenge.findOneAndUpdate(
    q,
    { $set: { ConsumedAt: new Date() } },
    { new: true },
  );
  if (!doc) {
    throw new ValidationError("Challenge WebAuthn không hợp lệ hoặc hết hạn.");
  }
  return doc;
}

/** @deprecated use claimChallengeByHash — kept for internal call sites */
async function consumeChallenge({ challenge, purpose, userId = null }) {
  return claimChallengeByHash({
    challenge,
    purpose,
    userId,
    markConsumed: true,
  });
}

async function registrationOptions({
  userId,
  email,
  host,
  strictRole = false,
}) {
  assertEnabled();
  const user = await User.findById(userId).select("Email FullName Status Role");
  if (!user) throw new NotFoundError("User not found");
  if (user.Status === "banned" || user.Status === "inactive") {
    throw new ForbiddenError("Tài khoản không khả dụng cho passkey.");
  }
  const challenge = await issueChallenge({ userId, purpose: "register", host });
  const existing = await WebAuthnCredential.find({ UserID: userId })
    .select("CredentialId")
    .lean();
  const uv = userVerificationRequirement(
    strictRole || user.Role === "admin" || user.Role === "host",
  );
  return {
    challenge,
    rp: { name: "WorkHub", id: rpIdFromHost(host) },
    user: {
      id: Buffer.from(String(userId)).toString("base64url"),
      name: email || user.Email,
      displayName: user.FullName || user.Email,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    timeout: 60000,
    attestation: "none",
    excludeCredentials: existing.map((c) => ({
      type: "public-key",
      id: c.CredentialId,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: uv,
    },
  };
}

/**
 * Register only via full navigator.credentials.create() response.
 * Never trust caller-supplied publicKey without attestation verification.
 *
 * Body shape:
 * {
 *   challenge,
 *   credential: { id, rawId, type, response: { clientDataJSON, attestationObject, transports }, clientExtensionResults },
 *   deviceName
 * }
 */
async function registerCredential({
  userId,
  challenge,
  credential,
  deviceName,
  strictRole = false,
}) {
  assertEnabled();

  if (!challenge) throw new ValidationError("Thiếu challenge.");
  if (!credential || typeof credential !== "object") {
    throw new ValidationError(
      "Thiếu credential WebAuthn (navigator.credentials.create response).",
    );
  }

  const credentialId = credential.id || credential.rawId;
  const response = credential.response || {};
  const clientDataJSON = response.clientDataJSON;
  const attestationObject = response.attestationObject;
  const transports =
    response.transports ||
    credential.transports ||
    (Array.isArray(credential.transports) ? credential.transports : []);

  if (!credentialId) throw new ValidationError("Thiếu credential.id.");
  if (!clientDataJSON || !attestationObject) {
    throw new ValidationError(
      "Thiếu clientDataJSON/attestationObject — publicKey fallback không được hỗ trợ.",
    );
  }

  // Reject any legacy publicKey-only path explicitly
  if (!clientDataJSON && (credential.publicKey || response.publicKey)) {
    throw new ValidationError(
      "Đăng ký passkey yêu cầu attestation đầy đủ; không chấp nhận publicKey client.",
    );
  }

  const user = await User.findById(userId).select("Status Role");
  if (!user) throw new NotFoundError("User not found");
  if (user.Status === "banned" || user.Status === "inactive") {
    throw new ForbiddenError("Tài khoản không khả dụng cho passkey.");
  }

  let verifyRegistrationResponse;
  try {
    ({ verifyRegistrationResponse } = require("@simplewebauthn/server"));
  } catch {
    throw new ValidationError("WebAuthn server library unavailable.");
  }

  // Peek challenge (not consume yet) for origin/RP expectations
  const challengeDoc = await claimChallengeByHash({
    challenge,
    purpose: "register",
    userId,
    markConsumed: false,
  });

  const requireUV = requireUserVerification(
    strictRole || user.Role === "admin" || user.Role === "host",
  );

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: {
        id: String(credentialId),
        rawId: String(credential.rawId || credentialId),
        type: credential.type || "public-key",
        response: {
          clientDataJSON: String(clientDataJSON),
          attestationObject: String(attestationObject),
          transports: Array.isArray(transports) ? transports : [],
        },
        clientExtensionResults: credential.clientExtensionResults || {},
      },
      expectedChallenge: String(challenge),
      expectedOrigin: challengeDoc.ExpectedOrigin || expectedOrigin(),
      expectedRPID: challengeDoc.ExpectedRpId || rpIdFromHost(),
      requireUserVerification: requireUV,
    });
  } catch (err) {
    if (err.statusCode) throw err;
    throw new UnauthorizedError("WebAuthn registration verification failed.");
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new UnauthorizedError("WebAuthn registration verification failed.");
  }

  // Atomic consume after successful crypto verify — concurrent replay loses
  await claimChallengeByHash({
    challenge,
    purpose: "register",
    userId,
    markConsumed: true,
  });

  const info = verification.registrationInfo;
  const cred = info.credential || info;
  const storedPublicKey = Buffer.from(
    cred.publicKey || info.credentialPublicKey,
  ).toString("base64url");
  const counter = cred.counter ?? info.counter ?? 0;
  const verifiedId = cred.id || String(credentialId);

  if (!storedPublicKey) {
    throw new UnauthorizedError("WebAuthn registration missing public key.");
  }

  try {
    const doc = await WebAuthnCredential.create({
      UserID: userId,
      CredentialId: String(verifiedId),
      PublicKey: storedPublicKey,
      Transports: Array.isArray(transports) ? transports.slice(0, 8) : [],
      DeviceName: String(deviceName || "Passkey").slice(0, 100),
      Counter: counter,
    });
    return doc;
  } catch (err) {
    if (err.code === 11000) {
      throw new ValidationError("Passkey đã được đăng ký.");
    }
    throw err;
  }
}

async function loginOptions({ email, host, strictRole = false }) {
  assertEnabled();
  const uv = userVerificationRequirement(strictRole);
  const user = await User.findOne({
    Email: String(email || "")
      .toLowerCase()
      .trim(),
  });
  if (!user) {
    const challenge = await issueChallenge({ purpose: "login", host });
    return {
      challenge,
      rpId: rpIdFromHost(host),
      timeout: 60000,
      allowCredentials: [],
      userVerification: uv,
    };
  }
  if (user.Status === "banned" || user.Status === "inactive") {
    // Same shape as empty allow list to avoid enumeration
    const challenge = await issueChallenge({ purpose: "login", host });
    return {
      challenge,
      rpId: rpIdFromHost(host),
      timeout: 60000,
      allowCredentials: [],
      userVerification: uv,
    };
  }
  const creds = await WebAuthnCredential.find({ UserID: user._id }).lean();
  const challenge = await issueChallenge({
    userId: user._id,
    purpose: "login",
    host,
  });
  return {
    challenge,
    rpId: rpIdFromHost(host),
    timeout: 60000,
    allowCredentials: creds.map((c) => ({
      type: "public-key",
      id: c.CredentialId,
      transports: c.Transports || [],
    })),
    userVerification: uv,
  };
}

/**
 * Authentication MUST verify cryptographic assertion. Stub signatures rejected.
 */
async function verifyLoginAssertion({
  challenge,
  credentialId,
  signature,
  clientDataJSON,
  authenticatorData,
  counter,
  host,
  credential,
  strictRole = false,
}) {
  assertEnabled();

  // Accept either flat fields or full assertion credential object
  if (credential && typeof credential === "object") {
    credentialId = credential.id || credential.rawId || credentialId;
    signature = credential.response?.signature || signature;
    clientDataJSON = credential.response?.clientDataJSON || clientDataJSON;
    authenticatorData =
      credential.response?.authenticatorData || authenticatorData;
  }

  if (!credentialId) throw new ValidationError("Thiếu credentialId.");
  if (!signature || signature === "stub" || signature === "skipped") {
    throw new UnauthorizedError("Chữ ký WebAuthn không hợp lệ.");
  }
  if (!clientDataJSON || !authenticatorData) {
    throw new ValidationError("Thiếu clientDataJSON/authenticatorData.");
  }
  if (!challenge) throw new ValidationError("Thiếu challenge.");

  const challengeDoc = await claimChallengeByHash({
    challenge,
    purpose: "login",
    markConsumed: false,
  });

  const cred = await WebAuthnCredential.findOne({
    CredentialId: String(credentialId),
  });
  if (!cred) throw new UnauthorizedError("Passkey không hợp lệ.");
  if (!cred.PublicKey) throw new UnauthorizedError("Passkey thiếu public key.");

  if (
    challengeDoc.UserID &&
    String(challengeDoc.UserID) !== String(cred.UserID)
  ) {
    throw new UnauthorizedError("Passkey không khớp tài khoản challenge.");
  }

  let verifyAuthenticationResponse;
  try {
    ({ verifyAuthenticationResponse } = require("@simplewebauthn/server"));
  } catch {
    throw new ValidationError("WebAuthn server library unavailable.");
  }

  const requireUV = requireUserVerification(strictRole);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: {
        id: String(credentialId),
        rawId: String(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: String(clientDataJSON),
          authenticatorData: String(authenticatorData),
          signature: String(signature),
        },
      },
      expectedChallenge: String(challenge),
      expectedOrigin: challengeDoc.ExpectedOrigin || expectedOrigin(),
      expectedRPID: challengeDoc.ExpectedRpId || rpIdFromHost(host),
      credential: {
        id: cred.CredentialId,
        publicKey: Buffer.from(String(cred.PublicKey), "base64url"),
        counter: cred.Counter || 0,
      },
      requireUserVerification: requireUV,
    });
  } catch {
    throw new UnauthorizedError("Chữ ký WebAuthn không hợp lệ.");
  }

  if (!verification || !verification.verified) {
    throw new UnauthorizedError("Chữ ký WebAuthn không hợp lệ.");
  }

  // Consume challenge only after successful verify (atomic)
  await claimChallengeByHash({
    challenge,
    purpose: "login",
    markConsumed: true,
  });

  const newCounter =
    verification.authenticationInfo?.newCounter ??
    (counter != null ? Number(counter) : (cred.Counter || 0) + 1);

  if (newCounter < (cred.Counter || 0)) {
    throw new UnauthorizedError("WebAuthn counter rollback — từ chối.");
  }

  const updated = await WebAuthnCredential.findOneAndUpdate(
    { _id: cred._id, Counter: { $lte: newCounter } },
    { $set: { Counter: newCounter, LastUsedAt: new Date() } },
    { new: true },
  );
  if (!updated) {
    throw new UnauthorizedError("WebAuthn counter update conflict.");
  }

  const user = await User.findById(cred.UserID);
  if (!user) throw new UnauthorizedError("Tài khoản không khả dụng.");
  if (user.Status === "banned") {
    throw new UnauthorizedError("Tài khoản đã bị khóa.");
  }
  if (user.Status !== "active") {
    throw new UnauthorizedError("Tài khoản không khả dụng.");
  }
  return user;
}

async function listCredentials(userId) {
  assertEnabled();
  return WebAuthnCredential.find({ UserID: userId })
    .select("-PublicKey")
    .sort({ createdAt: -1 })
    .lean();
}

async function revokeCredential(userId, credentialId) {
  assertEnabled();
  const doc = await WebAuthnCredential.findOneAndDelete({
    UserID: userId,
    CredentialId: credentialId,
  });
  if (!doc) throw new NotFoundError("Không tìm thấy passkey.");
  return { deleted: true };
}

function assertClientDataChallenge(clientDataJSON, expectedChallenge) {
  if (!clientDataJSON) return false;
  try {
    const json = JSON.parse(
      Buffer.from(String(clientDataJSON), "base64url").toString("utf8"),
    );
    if (json.type !== "webauthn.get" && json.type !== "webauthn.create") {
      return false;
    }
    const ch = json.challenge;
    if (!ch) return false;
    return (
      ch === expectedChallenge ||
      Buffer.from(ch, "base64url").toString("base64url") === expectedChallenge
    );
  } catch {
    return false;
  }
}

module.exports = {
  isEnabled,
  assertEnabled,
  registrationOptions,
  registerCredential,
  loginOptions,
  verifyLoginAssertion,
  listCredentials,
  revokeCredential,
  rpIdFromHost,
  assertClientDataChallenge,
  claimChallengeByHash,
  consumeChallenge,
  hashChallenge,
  userVerificationRequirement,
};
