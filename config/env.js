"use strict";

/**
 * Central environment validation. Fail fast if required secrets are missing.
 * Production rejects unsafe WebAuthn/mock-payment/webhook configurations.
 */
require("dotenv").config();

const REQUIRED = ["JWT_SECRET", "MONGODB_URI"];

function boolEnv(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return v === "1" || v === "true" || v === "TRUE" || v === "yes";
}

function validateEnv() {
  const missing = REQUIRED.filter((key) => {
    const val = process.env[key];
    return !val || String(val).trim() === "";
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Copy .env.example to .env and set real values. " +
        "Generate JWT_SECRET with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
    );
  }

  if (process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long.");
  }

  const forbidden = [
    "workhub_fallback_secret_key_2026",
    "YOUR_SECRET_KEY",
    "fallback-secret",
    "replace_with_a_long_random_secret",
  ];
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    for (const bad of forbidden) {
      if (process.env.JWT_SECRET.includes(bad)) {
        throw new Error(
          "JWT_SECRET looks like a placeholder; set a real secret in production.",
        );
      }
    }

    // WebAuthn: no unsafe combinations
    if (boolEnv("WEBAUTHN_ENABLED", false)) {
      if (boolEnv("WEBAUTHN_STRICT", true) === false) {
        throw new Error(
          "Production refuses WEBAUTHN_ENABLED=true with WEBAUTHN_STRICT=false.",
        );
      }
      if (!process.env.WEBAUTHN_RP_ID || !process.env.WEBAUTHN_ORIGIN) {
        throw new Error(
          "WEBAUTHN_ENABLED requires WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN in production.",
        );
      }
    }

    // Mock payment must be off
    if (boolEnv("ALLOW_MOCK_PAYMENT_PROVIDER", false)) {
      throw new Error(
        "ALLOW_MOCK_PAYMENT_PROVIDER cannot be true in production.",
      );
    }
    if (boolEnv("ALLOW_MOCK_COMPLETE", false)) {
      throw new Error("ALLOW_MOCK_COMPLETE cannot be true in production.");
    }

    const payProvider = String(
      process.env.PAYMENT_PROVIDER || "workhub_mock",
    ).toLowerCase();
    if (payProvider.includes("mock") || payProvider === "workhub_mock") {
      throw new Error(
        "PAYMENT_PROVIDER cannot be a mock provider in production. Set stripe or momo with credentials.",
      );
    }

    if (payProvider === "stripe") {
      if (
        !process.env.STRIPE_SECRET_KEY ||
        !process.env.STRIPE_WEBHOOK_SECRET
      ) {
        throw new Error(
          "Stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in production.",
        );
      }
    }
    if (payProvider === "momo") {
      if (
        !process.env.MOMO_PARTNER_CODE ||
        !process.env.MOMO_ACCESS_KEY ||
        !process.env.MOMO_SECRET_KEY
      ) {
        throw new Error(
          "MoMo requires MOMO_PARTNER_CODE, MOMO_ACCESS_KEY, MOMO_SECRET_KEY in production.",
        );
      }
    }

    // Webhook secret must not fall back to JWT
    if (
      !process.env.GATEWAY_WEBHOOK_SECRET ||
      process.env.GATEWAY_WEBHOOK_SECRET === process.env.JWT_SECRET
    ) {
      throw new Error(
        "GATEWAY_WEBHOOK_SECRET must be set and distinct from JWT_SECRET in production.",
      );
    }

    // Domain-separated secrets — required and non-overlapping in production
    const domainSecrets = {
      SESSION_SECRET: process.env.SESSION_SECRET,
      CSRF_SECRET: process.env.CSRF_SECRET,
      CHECKIN_TOKEN_SECRET: process.env.CHECKIN_TOKEN_SECRET,
      OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET,
      ICAL_FEED_SECRET: process.env.ICAL_FEED_SECRET,
    };
    for (const [name, val] of Object.entries(domainSecrets)) {
      if (!val || String(val).length < 32) {
        throw new Error(
          `${name} must be set (≥32 chars) and distinct in production.`,
        );
      }
      if (val === process.env.JWT_SECRET) {
        throw new Error(`${name} must not equal JWT_SECRET in production.`);
      }
    }
    const vals = Object.values(domainSecrets);
    if (new Set(vals).size !== vals.length) {
      throw new Error(
        "Critical secrets SESSION/CSRF/CHECKIN/OAUTH/ICAL must be unique pairwise.",
      );
    }

    // Public base URL
    const base = process.env.PUBLIC_BASE_URL || "";
    if (!base.startsWith("https://")) {
      throw new Error(
        "PUBLIC_BASE_URL must be an absolute https:// URL in production.",
      );
    }
    try {
      const u = new URL(base);
      if (u.pathname && u.pathname !== "/") {
        throw new Error("PUBLIC_BASE_URL must not include a path.");
      }
      if (u.search || u.hash) {
        throw new Error("PUBLIC_BASE_URL must not include query or hash.");
      }
    } catch (e) {
      if (e.message.includes("PUBLIC_BASE_URL")) throw e;
      throw new Error("PUBLIC_BASE_URL is not a valid URL.");
    }

    if (boolEnv("ALLOW_GOOGLE_MOCK", false)) {
      throw new Error("ALLOW_GOOGLE_MOCK cannot be true in production.");
    }

    // Mongo multi-doc transactions are mandatory in production
    if (boolEnv("ENABLE_TRANSACTIONS", true) === false) {
      throw new Error(
        "Mongo transactions are required in production (ENABLE_TRANSACTIONS cannot be false).",
      );
    }

    // Node runtime floor
    const parts = process.versions.node.split(".").map(Number);
    const major = parts[0] || 0;
    const minor = parts[1] || 0;
    if (major < 20 || (major === 20 && minor < 19)) {
      throw new Error(
        `Node.js >=20.19.0 is required (current: ${process.versions.node}).`,
      );
    }
  }

  // Always fail fast on unsupported Node when below engines floor
  {
    const parts = process.versions.node.split(".").map(Number);
    const major = parts[0] || 0;
    if (major < 20) {
      throw new Error(
        `Unsupported Node.js ${process.versions.node}. WorkHub requires Node >=20.19.0.`,
      );
    }
  }
}

validateEnv();

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const isTest = nodeEnv === "test";
const isDev = !isProduction;

const env = {
  NODE_ENV: nodeEnv,
  PORT: Number(process.env.PORT) || 3000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "1d",
  SESSION_SECRET: process.env.SESSION_SECRET || process.env.JWT_SECRET,
  CSRF_SECRET:
    process.env.CSRF_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET,
  CHECKIN_TOKEN_SECRET:
    process.env.CHECKIN_TOKEN_SECRET || process.env.JWT_SECRET,
  OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET,
  ICAL_FEED_SECRET: process.env.ICAL_FEED_SECRET || process.env.JWT_SECRET,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || "",
  COOKIE_SECURE: isProduction || boolEnv("COOKIE_SECURE", false),
  TRUST_PROXY: boolEnv("TRUST_PROXY", false),
  BOOKING_SLOT_MINUTES: Number(process.env.BOOKING_SLOT_MINUTES) || 30,
  MAX_BOOKING_HOURS: Number(process.env.MAX_BOOKING_HOURS) || 24,
  MAX_BOOKING_DAYS_AHEAD: Number(process.env.MAX_BOOKING_DAYS_AHEAD) || 180,
  ENABLE_TRANSACTIONS: boolEnv("ENABLE_TRANSACTIONS", isProduction),
  /** After migration cutoff, reject JWTs without sid (default: production only). */
  SESSION_REQUIRE_SID: boolEnv(
    "SESSION_REQUIRE_SID",
    isProduction,
  ),
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || "",
  EMAIL_FROM: process.env.EMAIL_FROM || "",
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  CSRF_COOKIE_NAME: "csrfToken",
  AUTH_COOKIE_NAME: "authToken",
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  METRICS_AUTH_TOKEN: process.env.METRICS_AUTH_TOKEN || "",
  PAYMENT_PROVIDER: String(
    process.env.PAYMENT_PROVIDER || (isProduction ? "" : "workhub_mock"),
  ).toLowerCase(),
  ALLOW_MOCK_PAYMENT_PROVIDER: boolEnv(
    "ALLOW_MOCK_PAYMENT_PROVIDER",
    isTest || isDev,
  ),
  ALLOW_MOCK_COMPLETE: boolEnv("ALLOW_MOCK_COMPLETE", isTest || isDev),
  GATEWAY_WEBHOOK_SECRET: process.env.GATEWAY_WEBHOOK_SECRET || "",
  WEBAUTHN_ENABLED: boolEnv("WEBAUTHN_ENABLED", false),
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID || "localhost",
  WEBAUTHN_ORIGIN:
    process.env.WEBAUTHN_ORIGIN ||
    process.env.PUBLIC_BASE_URL ||
    "http://localhost:3000",
  /** required | preferred | discouraged — production should use required */
  WEBAUTHN_USER_VERIFICATION: (
    process.env.WEBAUTHN_USER_VERIFICATION ||
    (isProduction ? "required" : "preferred")
  ).toLowerCase(),
  MEMBERSHIP_PAID_ENABLED: boolEnv("MEMBERSHIP_PAID_ENABLED", false),
  isDev,
  isTest,
  isProduction,
};

module.exports = env;
