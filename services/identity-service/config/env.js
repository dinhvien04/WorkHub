"use strict";

const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config();

const required = [
  "MONGODB_IDENTITY_URI",
  "RABBITMQ_URL",
  "JWT_SECRET",
  "IDENTITY_INTERNAL_SECRET",
];

const missing = [];
required.forEach((envVar) => {
  if (!process.env[envVar]) missing.push(envVar);
});

if (missing.length > 0 && process.env.NODE_ENV !== "test") {
  throw new Error(
    `Missing required environment variables in identity-service: ${missing.join(", ")}`,
  );
}

if (
  process.env.NODE_ENV === "production" &&
  (!process.env.JWT_SECRET ||
    process.env.JWT_SECRET === "replace_with_a_long_random_secret" ||
    process.env.JWT_SECRET === "default_test_jwt_secret_at_least_32_chars_long")
) {
  throw new Error("Missing or default JWT_SECRET in identity-service production.");
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.IDENTITY_PORT) || Number(process.env.PORT) || 3004,
  MONGODB_IDENTITY_URI:
    process.env.MONGODB_IDENTITY_URI ||
    "mongodb://127.0.0.1:27017/workhub_identity",
  RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",
  JWT_SECRET:
    process.env.JWT_SECRET || "default_test_jwt_secret_at_least_32_chars_long",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "1d",
  IDENTITY_INTERNAL_SECRET:
    process.env.IDENTITY_INTERNAL_SECRET ||
    "default_test_identity_internal_secret_key",
  COOKIE_SECURE:
    process.env.NODE_ENV === "production" ||
    process.env.COOKIE_SECURE === "1" ||
    process.env.COOKIE_SECURE === "true",
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || "authToken",
  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",
};
