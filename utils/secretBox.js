"use strict";

/**
 * Short-lived authenticated encryption for outbox secrets.
 * Key must be distinct from JWT/CSRF (OUTBOX_SECRET_KEY or derived SESSION_SECRET).
 */
const crypto = require("crypto");
const env = require("../config/env");

function secretKey() {
  const raw =
    process.env.OUTBOX_SECRET_KEY ||
    process.env.SESSION_SECRET ||
    env.JWT_SECRET;
  return crypto.createHash("sha256").update(String(raw)).digest();
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const key = secretKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  const buf = Buffer.from(String(ciphertext), "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = secretKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

module.exports = { encrypt, decrypt };
