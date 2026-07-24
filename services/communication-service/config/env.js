"use strict";

const dotenv = require("dotenv");
const path = require("path");

// Load .env from root or locally
dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config();

const required = [
  "MONGODB_COMMUNICATION_URI",
  "RABBITMQ_URL",
  "JWT_SECRET",
];

const missing = [];
required.forEach((envVar) => {
  if (!process.env[envVar]) {
    missing.push(envVar);
  }
});

if (missing.length > 0 && process.env.NODE_ENV !== "test") {
  throw new Error(`Missing required environment variables in communication-service: ${missing.join(", ")}`);
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.COMMUNICATION_PORT) || Number(process.env.PORT) || 3002,
  MONGODB_COMMUNICATION_URI: process.env.MONGODB_COMMUNICATION_URI || "mongodb://127.0.0.1:27017/workhub_communication",
  RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",
  JWT_SECRET: process.env.JWT_SECRET || "default_test_jwt_secret_at_least_32_chars_long",
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || "",
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || "",
  VAPID_EMAIL: process.env.VAPID_EMAIL || "mailto:support@workhub.local",
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  EMAIL_FROM: process.env.EMAIL_FROM || "WorkHub <no-reply@workhub.local>",
  SHADOW_MODE: process.env.COMMUNICATION_SHADOW_MODE === "true",
  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",
};
