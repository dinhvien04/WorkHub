"use strict";

const dotenv = require("dotenv");
const path = require("path");

// Load .env from root or locally
dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config();

const required = [
  "MONGODB_CONTENT_URI",
  "RABBITMQ_URL",
  "JWT_SECRET",
  "CONTENT_INTERNAL_SECRET",
];

const missing = [];
required.forEach((envVar) => {
  if (!process.env[envVar]) {
    missing.push(envVar);
  }
});

if (missing.length > 0 && process.env.NODE_ENV !== "test") {
  throw new Error(`Missing required environment variables in content-service: ${missing.join(", ")}`);
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.CONTENT_PORT) || Number(process.env.PORT) || 3003,
  MONGODB_CONTENT_URI: process.env.MONGODB_CONTENT_URI || "mongodb://127.0.0.1:27017/workhub_content",
  RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",
  JWT_SECRET: process.env.JWT_SECRET || "default_test_jwt_secret_at_least_32_chars_long",
  SHADOW_MODE: process.env.CONTENT_SHADOW_MODE === "true",
  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",
};
