"use strict";

/**
 * Single source of truth for password hashing and verification.
 *
 * New hashes are always Argon2id. Legacy bcrypt hashes stay verifiable so the
 * migration can happen lazily on successful login, but nothing writes bcrypt.
 *
 * Every password check in the service must go through verifyPassword() — an
 * earlier bug shipped `bcrypt.compare()` against Argon2id hashes in the
 * disable-2FA path, which silently rejected every correct password.
 */
const argon2 = require("argon2");
const bcrypt = require("bcryptjs");

// OWASP Password Storage Cheat Sheet (2024) second-choice profile for Argon2id.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

function isArgon2Hash(hash) {
  return typeof hash === "string" && hash.startsWith("$argon2");
}

function isBcryptHash(hash) {
  return typeof hash === "string" && /^\$2[aby]?\$/.test(hash);
}

async function hashPassword(plaintext) {
  return argon2.hash(String(plaintext), ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash of either algorithm.
 *
 * Returns { ok, needsRehash }. `needsRehash` is true when the stored hash is a
 * legacy bcrypt hash and the password matched, so the caller can upgrade it.
 * Never throws on malformed input — an unparseable hash is simply a mismatch.
 */
async function verifyPassword(plaintext, storedHash) {
  const password = String(plaintext == null ? "" : plaintext);
  const hash = String(storedHash == null ? "" : storedHash);

  if (!password || !hash) return { ok: false, needsRehash: false };

  if (isArgon2Hash(hash)) {
    try {
      return { ok: await argon2.verify(hash, password), needsRehash: false };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }

  if (isBcryptHash(hash)) {
    try {
      const ok = await bcrypt.compare(password, hash);
      return { ok, needsRehash: ok };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }

  // Unknown/absent algorithm prefix — treat as a non-match rather than
  // falling through to a plaintext comparison.
  return { ok: false, needsRehash: false };
}

module.exports = {
  ARGON2_OPTIONS,
  hashPassword,
  verifyPassword,
  isArgon2Hash,
  isBcryptHash,
};
