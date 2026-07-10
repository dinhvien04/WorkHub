"use strict";

/**
 * Google OIDC — Authorization Code + verified ID token.
 * Never trust base64-decoded JWT without signature verification.
 * State/nonce stored in signed HttpOnly cookie (multi-instance safe).
 * Email collision does NOT silently take over local accounts.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const env = require("../config/env");
const {
  ValidationError,
  UnauthorizedError,
  ConflictError,
} = require("../utils/errors");

const STATE_COOKIE = "google_oauth_state";

function configured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

function mockAllowed() {
  if (env.isProduction) return false;
  return (
    env.isTest ||
    process.env.ALLOW_GOOGLE_MOCK === "1" ||
    process.env.ALLOW_GOOGLE_MOCK === "true"
  );
}

function redirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  if (env.PUBLIC_BASE_URL)
    return `${env.PUBLIC_BASE_URL}/api/auth/google/callback`;
  const host = req.get("host");
  const proto = req.protocol || "http";
  return `${proto}://${host}/api/auth/google/callback`;
}

function signStatePayload(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "10m" });
}

function verifyStatePayload(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch {
    return null;
  }
}

function setStateCookie(res, stateToken) {
  res.cookie(STATE_COOKIE, stateToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
}

function clearStateCookie(res) {
  res.clearCookie(STATE_COOKIE, { path: "/" });
}

function authorizationUrl(req, res) {
  if (!configured()) {
    throw new ValidationError(
      "Google OIDC chưa cấu hình (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
    );
  }
  const state = crypto.randomBytes(24).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const stateToken = signStatePayload({
    state,
    nonce,
    purpose: "google_oauth",
  });
  if (res) setStateCookie(res, stateToken);

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    access_type: "online",
    prompt: "select_account",
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    state,
  };
}

async function exchangeCode(req, code) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(req),
    grant_type: "authorization_code",
  });
  const res = await globalThis.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new UnauthorizedError("Google token exchange failed.");
  }
  return res.json();
}

/**
 * Verify Google ID token signature + claims via google-auth-library.
 */
async function verifyIdToken(idToken, expectedNonce) {
  if (!idToken) throw new UnauthorizedError("Thiếu id_token.");
  let OAuth2Client;
  try {
    ({ OAuth2Client } = require("google-auth-library"));
  } catch {
    throw new ValidationError("google-auth-library unavailable.");
  }
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
  } catch {
    throw new UnauthorizedError("Google id_token không hợp lệ.");
  }
  const payload = ticket.getPayload();
  if (!payload) throw new UnauthorizedError("Google id_token không hợp lệ.");

  const iss = payload.iss;
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com") {
    throw new UnauthorizedError("Google id_token issuer không hợp lệ.");
  }
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new UnauthorizedError("Google id_token đã hết hạn.");
  }
  if (expectedNonce) {
    if (!payload.nonce || payload.nonce !== expectedNonce) {
      throw new UnauthorizedError("Nonce OIDC không khớp.");
    }
  }
  if (payload.email_verified === false) {
    throw new UnauthorizedError("Email Google chưa verified.");
  }
  return payload;
}

/**
 * Link by GoogleSub only. Email collision without GoogleSub requires explicit linking.
 */
async function upsertGoogleUser(profile) {
  const email = String(profile.email || "")
    .toLowerCase()
    .trim();
  const sub = profile.sub;
  if (!email || !sub)
    throw new ValidationError("Google profile thiếu email/sub.");

  let user = await User.findOne({ GoogleSub: sub });
  if (user) {
    if (user.Status === "banned")
      throw new UnauthorizedError("Tài khoản đã bị khóa.");
    if (user.Status === "inactive" && user.Role !== "customer") {
      throw new UnauthorizedError("Tài khoản chưa được kích hoạt.");
    }
    if (user.Status === "inactive" && user.Role === "customer") {
      user.Status = "active";
      user.EmailVerified = true;
      user.EmailVerifiedAt = user.EmailVerifiedAt || new Date();
      await user.save();
    }
    return user;
  }

  // Email exists without GoogleSub — refuse silent takeover
  const byEmail = await User.findOne({ Email: email });
  if (byEmail) {
    throw new ConflictError(
      "Email đã tồn tại. Đăng nhập tài khoản hiện có rồi liên kết Google từ trang bảo mật.",
    );
  }

  const randomPass = crypto.randomBytes(32).toString("hex");
  const bcrypt = require("bcryptjs");
  user = await User.create({
    Email: email,
    FullName: profile.name || email.split("@")[0],
    PasswordHash: await bcrypt.hash(randomPass, 10),
    Role: "customer",
    Status: "active",
    AuthProvider: "google",
    GoogleSub: sub,
    EmailVerified: true,
    EmailVerifiedAt: new Date(),
    tokenVersion: 0,
  });
  try {
    const CustomerProfile = require("../models/Customer_Profile");
    await CustomerProfile.create({
      UserID: user._id,
      Phone: "",
      Avatar: profile.picture || "",
    });
  } catch {
    /* ignore duplicate profile */
  }
  return user;
}

async function handleCallback(req, res, { code, state }) {
  if (!configured()) throw new ValidationError("Google OIDC chưa cấu hình.");
  if (!code || !state) throw new ValidationError("Thiếu code/state.");

  const cookieToken = req.cookies?.[STATE_COOKIE];
  const st = cookieToken ? verifyStatePayload(cookieToken) : null;
  if (res) clearStateCookie(res);
  if (!st || st.purpose !== "google_oauth" || st.state !== state) {
    throw new UnauthorizedError("State OAuth không hợp lệ hoặc hết hạn.");
  }

  const tokens = await exchangeCode(req, code);
  const profile = await verifyIdToken(tokens.id_token, st.nonce);
  return upsertGoogleUser(profile);
}

/** Test/dev only — no real Google call; still uses upsert safety rules */
async function mockLogin({ email, name, sub }) {
  if (!mockAllowed()) {
    throw new ValidationError(
      "Google mock chỉ bật khi test hoặc ALLOW_GOOGLE_MOCK=1.",
    );
  }
  const em = String(email || "google.user@example.com").toLowerCase();
  return upsertGoogleUser({
    sub:
      sub ||
      `mock-google-${crypto.createHash("sha256").update(em).digest("hex").slice(0, 24)}`,
    email: em,
    name: name || "Google User",
    email_verified: true,
    picture: "",
  });
}

/**
 * Explicit link for logged-in user after re-auth (not implemented fully in UI yet).
 */
async function linkGoogleSub(userId, profile) {
  const user = await User.findById(userId);
  if (!user) throw new ValidationError("User not found");
  if (user.Status === "banned")
    throw new UnauthorizedError("Tài khoản đã bị khóa.");
  const existing = await User.findOne({ GoogleSub: profile.sub });
  if (existing && String(existing._id) !== String(userId)) {
    throw new ConflictError("Google account đã liên kết user khác.");
  }
  user.GoogleSub = profile.sub;
  user.EmailVerified = true;
  user.EmailVerifiedAt = user.EmailVerifiedAt || new Date();
  await user.save();
  return user;
}

module.exports = {
  configured,
  mockAllowed,
  authorizationUrl,
  handleCallback,
  mockLogin,
  upsertGoogleUser,
  verifyIdToken,
  linkGoogleSub,
  STATE_COOKIE,
};
