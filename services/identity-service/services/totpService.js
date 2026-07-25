"use strict";

/**
 * RFC 6238 TOTP (SHA-1, 30s, 6 digits) — no external OTP dependency.
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const STEP = 30;
const DIGITS = 6;
const WINDOW = 1;

function base32Encode(buf) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(str || "")
    .toUpperCase()
    .replace(/=+$/, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

function totpAt(secretBase32, timeMs = Date.now()) {
  const counter = Math.floor(timeMs / 1000 / STEP);
  return hotp(base32Decode(secretBase32), counter);
}

function verifyTotp(secretBase32, token, { window = WINDOW } = {}) {
  const code = String(token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    const t = now + w * STEP * 1000;
    if (totpAt(secretBase32, t) === code) return true;
  }
  return false;
}

function otpauthUrl({ secret, email, issuer = "WorkHub" }) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function generateRecoveryCodes(count = 8) {
  const plain = [];
  for (let i = 0; i < count; i++) {
    plain.push(crypto.randomBytes(4).toString("hex"));
  }
  return plain;
}

async function hashRecoveryCodes(codes) {
  return Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
}

async function consumeRecoveryCode(hashedList, plainCode) {
  const code = String(plainCode || "")
    .trim()
    .toLowerCase();
  if (!code) return { ok: false, remaining: hashedList };
  const remaining = [];
  let matched = false;
  for (const h of hashedList || []) {
    if (!matched && (await bcrypt.compare(code, h))) {
      matched = true;
      continue;
    }
    remaining.push(h);
  }
  return { ok: matched, remaining };
}

const KEY_VERSION = process.env.IDENTITY_TOTP_KEY_VERSION || "v1";

function getEncryptionKey() {
  const envKey = process.env.IDENTITY_TOTP_ENCRYPTION_KEY;
  if (envKey) {
    const buf = Buffer.from(envKey, "hex");
    if (buf.length === 32) return buf;
  }
  const internalSecret = process.env.IDENTITY_INTERNAL_SECRET || "default_test_identity_internal_secret_key";
  return crypto.createHash("sha256").update(internalSecret).digest();
}

function encryptSecret(plaintextSecret, userId) {
  if (!plaintextSecret) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  cipher.setAAD(Buffer.from(String(userId)));

  let encrypted = cipher.update(plaintextSecret, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return `${KEY_VERSION}:${iv.toString("hex")}:${tag}:${encrypted}`;
}

function decryptSecret(encryptedSecret, userId) {
  if (!encryptedSecret) return null;
  const parts = String(encryptedSecret).split(":");
  if (parts.length !== 4) {
    return encryptedSecret; // fallback for legacy plaintext
  }

  const [_version, ivHex, tagHex, ciphertextHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(Buffer.from(String(userId)));

  let decrypted = decipher.update(ciphertextHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

module.exports = {
  generateSecret,
  totpAt,
  verifyTotp,
  otpauthUrl,
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
  base32Encode,
  base32Decode,
  encryptSecret,
  decryptSecret,
};
