"use strict";

const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config();

function boolEnv(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return v === "1" || v === "true" || v === "TRUE" || v === "yes";
}

function listEnv(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const isTest = nodeEnv === "test";
const isDev = !isProduction;

const required = [
  "MONGODB_IDENTITY_URI",
  "RABBITMQ_URL",
  "JWT_SECRET",
  "IDENTITY_INTERNAL_SECRET",
];

// Secrets that must never fall back to a derived or shared value in production.
const productionRequired = [
  "IDENTITY_JWT_ACTIVE_KID",
  "IDENTITY_PREAUTH_JWT_SECRET",
  "IDENTITY_CSRF_SECRET",
  "PASSWORD_RESET_PEPPER",
  "IDENTITY_TOTP_ENCRYPTION_KEY",
  "IDENTITY_TOTP_KEY_VERSION",
  "IDENTITY_ALLOWED_ORIGINS",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0 && !isTest) {
  throw new Error(
    `Missing required environment variables in identity-service: ${missing.join(", ")}`,
  );
}

if (isProduction) {
  const missingProd = productionRequired.filter((name) => !process.env[name]);
  if (missingProd.length > 0) {
    throw new Error(
      `Missing required production environment variables in identity-service: ${missingProd.join(", ")}`,
    );
  }

  if (
    !process.env.IDENTITY_JWT_PRIVATE_KEY &&
    !process.env.IDENTITY_JWT_PRIVATE_KEY_FILE
  ) {
    throw new Error(
      "identity-service production requires IDENTITY_JWT_PRIVATE_KEY or IDENTITY_JWT_PRIVATE_KEY_FILE.",
    );
  }

  const weakJwtSecrets = [
    "replace_with_a_long_random_secret",
    "default_test_jwt_secret_at_least_32_chars_long",
  ];
  if (weakJwtSecrets.includes(process.env.JWT_SECRET)) {
    throw new Error("Missing or default JWT_SECRET in identity-service production.");
  }

  // Distinct keys per purpose: reusing JWT_SECRET for step-up tokens would let
  // a pre-auth token be presented as a full access token.
  if (process.env.IDENTITY_PREAUTH_JWT_SECRET === process.env.JWT_SECRET) {
    throw new Error(
      "IDENTITY_PREAUTH_JWT_SECRET must differ from JWT_SECRET in identity-service production.",
    );
  }
  if (process.env.IDENTITY_CSRF_SECRET === process.env.JWT_SECRET) {
    throw new Error(
      "IDENTITY_CSRF_SECRET must differ from JWT_SECRET in identity-service production.",
    );
  }
}

const legacyJwtDeadlineRaw = process.env.IDENTITY_LEGACY_JWT_DEADLINE || "";
if (legacyJwtDeadlineRaw && Number.isNaN(new Date(legacyJwtDeadlineRaw).getTime())) {
  throw new Error("IDENTITY_LEGACY_JWT_DEADLINE must be a valid ISO date.");
}

module.exports = {
  NODE_ENV: nodeEnv,
  PORT: Number(process.env.IDENTITY_PORT) || Number(process.env.PORT) || 3004,
  MONGODB_IDENTITY_URI:
    process.env.MONGODB_IDENTITY_URI ||
    "mongodb://127.0.0.1:27017/workhub_identity",
  RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",

  JWT_SECRET:
    process.env.JWT_SECRET || "default_test_jwt_secret_at_least_32_chars_long",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "1d",

  // Step-up (pre-auth 2FA) tokens are signed with their own key.
  IDENTITY_PREAUTH_JWT_SECRET:
    process.env.IDENTITY_PREAUTH_JWT_SECRET ||
    (isProduction ? "" : "dev_preauth_2fa_signing_secret_not_for_production"),

  IDENTITY_CSRF_SECRET:
    process.env.IDENTITY_CSRF_SECRET ||
    (isProduction ? "" : "dev_identity_csrf_secret_not_for_production"),

  PASSWORD_RESET_PEPPER:
    process.env.PASSWORD_RESET_PEPPER ||
    (isProduction ? "" : "dev_password_reset_pepper_not_for_production"),

  IDENTITY_INTERNAL_SECRET:
    process.env.IDENTITY_INTERNAL_SECRET ||
    "default_test_identity_internal_secret_key",

  // Legacy monolith HS256 acceptance window.
  IDENTITY_LEGACY_JWT_ENABLED: boolEnv("IDENTITY_LEGACY_JWT_ENABLED", !isProduction),
  IDENTITY_LEGACY_JWT_DEADLINE: legacyJwtDeadlineRaw,

  // Origins allowed to drive cookie-authenticated mutations.
  IDENTITY_ALLOWED_ORIGINS: listEnv("IDENTITY_ALLOWED_ORIGINS"),

  // Host registration is owned by the onboarding saga until Catalog (M7).
  IDENTITY_ALLOW_DIRECT_HOST_REGISTRATION: boolEnv(
    "IDENTITY_ALLOW_DIRECT_HOST_REGISTRATION",
    false,
  ),

  OUTBOX_POLL_INTERVAL_MS: Number(process.env.IDENTITY_OUTBOX_POLL_INTERVAL_MS) || 2000,
  OUTBOX_BATCH_SIZE: Number(process.env.IDENTITY_OUTBOX_BATCH_SIZE) || 20,
  OUTBOX_MAX_ATTEMPTS: Number(process.env.IDENTITY_OUTBOX_MAX_ATTEMPTS) || 8,
  OUTBOX_LEASE_MS: Number(process.env.IDENTITY_OUTBOX_LEASE_MS) || 30000,
  DISABLE_MQ: boolEnv("DISABLE_MQ", false),

  COOKIE_SECURE: isProduction || boolEnv("COOKIE_SECURE", false),
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || "authToken",
  CSRF_COOKIE_NAME: process.env.CSRF_COOKIE_NAME || "csrfToken",
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),

  WEBAUTHN_ENABLED: boolEnv("WEBAUTHN_ENABLED", false),
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID || "localhost",
  WEBAUTHN_ORIGIN:
    process.env.WEBAUTHN_ORIGIN ||
    process.env.PUBLIC_BASE_URL ||
    "http://localhost:3000",
  WEBAUTHN_USER_VERIFICATION: (
    process.env.WEBAUTHN_USER_VERIFICATION ||
    (isProduction ? "required" : "preferred")
  ).toLowerCase(),

  SESSION_REQUIRE_SID: boolEnv("SESSION_REQUIRE_SID", isProduction),
  isProduction,
  isTest,
  isDev,
};
