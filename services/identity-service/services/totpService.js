"use strict";

/**
 * RFC 6238 TOTP (SHA-1, 30s, 6 digits) — no external OTP dependency.
 *
 * Seeds are encrypted at rest through the versioned keyring in ./keyring.js,
 * with the user id bound in as AAD so a seed cannot be replayed onto another
 * account. Recovery codes are bcrypt-hashed and consumed with a conditional
 * update so two concurrent requests cannot spend the same code.
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getTotpKeyring, KeyringError } = require("./keyring");

const STEP = 30;
const DIGITS = 6;
const WINDOW = 1;
const RECOVERY_CODE_BYTES = 5;

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
  if (!secretBase32) return false;
  const code = String(token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;

  const now = Date.now();
  let matched = false;
  // Walk every step in the window so the comparison cost does not leak which
  // step matched.
  for (let w = -window; w <= window; w++) {
    const candidate = totpAt(secretBase32, now + w * STEP * 1000);
    const a = Buffer.from(candidate);
    const b = Buffer.from(code);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) matched = true;
  }
  return matched;
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
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(RECOVERY_CODE_BYTES).toString("hex"));
  }
  return codes;
}

async function hashRecoveryCodes(codes) {
  return Promise.all(codes.map((c) => bcrypt.hash(String(c).toLowerCase(), 10)));
}

/**
 * Atomically spend one recovery code.
 *
 * bcrypt hashes are salted, so the matching hash has to be found in memory —
 * but the removal is a conditional $pull on that exact hash string. If two
 * requests race, only the first update matches and the loser gets ok:false.
 */
async function consumeRecoveryCodeAtomic(UserModel, userId, plainCode, { session } = {}) {
  const code = String(plainCode || "").trim().toLowerCase();
  if (!code) return { ok: false };

  const query = UserModel.findById(userId).select("+TotpRecoveryHashes");
  if (session) query.session(session);
  const user = await query;
  const hashes = (user && user.TotpRecoveryHashes) || [];

  for (const hash of hashes) {
    let matches = false;
    try {
      matches = await bcrypt.compare(code, hash);
    } catch {
      matches = false;
    }
    if (!matches) continue;

    const updateOpts = session ? { session } : {};
    const result = await UserModel.updateOne(
      { _id: userId, TotpRecoveryHashes: hash },
      { $pull: { TotpRecoveryHashes: hash } },
      updateOpts,
    );

    // modifiedCount 0 means a concurrent request already spent this code.
    if (result.modifiedCount === 1) return { ok: true, consumedHash: hash };
    return { ok: false, raced: true };
  }

  return { ok: false };
}

function encryptSecret(plaintextSecret, userId) {
  return getTotpKeyring().encrypt(plaintextSecret, userId);
}

/**
 * Decrypt a stored seed. Throws KeyringError on malformed ciphertext, a
 * missing key version, or a failed authentication tag — callers must treat
 * that as "2FA is broken for this account", never as a successful verify.
 */
function decryptSecret(encryptedSecret, userId) {
  return getTotpKeyring().decrypt(encryptedSecret, userId);
}

/**
 * Decrypt without throwing, for verification paths that must fail closed.
 */
function tryDecryptSecret(encryptedSecret, userId) {
  try {
    return { ok: true, secret: decryptSecret(encryptedSecret, userId) };
  } catch (err) {
    if (err instanceof KeyringError) return { ok: false, error: err.message };
    throw err;
  }
}

function needsRotation(storedSecret) {
  return getTotpKeyring().needsRotation(storedSecret);
}

module.exports = {
  generateSecret,
  totpAt,
  verifyTotp,
  otpauthUrl,
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCodeAtomic,
  base32Encode,
  base32Decode,
  encryptSecret,
  decryptSecret,
  tryDecryptSecret,
  needsRotation,
  STEP,
  DIGITS,
};
