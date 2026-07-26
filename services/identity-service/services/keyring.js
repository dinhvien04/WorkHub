"use strict";

/**
 * Versioned AES-256-GCM keyring for secrets encrypted at rest (TOTP seeds).
 *
 * Ciphertext format: `<version>:<ivHex>:<tagHex>:<ciphertextHex>`
 *
 * The version prefix selects the decryption key, so rotation is: promote a new
 * key to active, keep the old one in the previous list until every row has been
 * re-encrypted, then drop it. Encryption always uses the active key.
 *
 * Env:
 *   IDENTITY_TOTP_ENCRYPTION_KEY   64 hex chars (32 bytes) — active key
 *   IDENTITY_TOTP_KEY_VERSION      label for the active key, e.g. "v2"
 *   IDENTITY_TOTP_PREVIOUS_KEYS    "v1:<64hex>,v0:<64hex>" — decrypt-only
 *   IDENTITY_TOTP_ALLOW_LEGACY_PLAINTEXT  "true" to accept unencrypted seeds
 *   IDENTITY_TOTP_LEGACY_DEADLINE  ISO date after which plaintext is rejected
 */
const crypto = require("crypto");

const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

class KeyringError extends Error {
  constructor(message) {
    super(message);
    this.name = "KeyringError";
  }
}

function parseHexKey(value, label) {
  const hex = String(value || "").trim();
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== KEY_BYTES * 2) {
    throw new KeyringError(
      `${label} must be exactly ${KEY_BYTES * 2} hex characters (${KEY_BYTES} bytes).`,
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Parse "v1:<hex>,v0:<hex>" into a Map of version -> key buffer.
 */
function parsePreviousKeys(raw) {
  const keys = new Map();
  const entries = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const sep = entry.indexOf(":");
    if (sep <= 0) {
      throw new KeyringError(
        `IDENTITY_TOTP_PREVIOUS_KEYS entry "${entry}" must use "<version>:<hex>" form.`,
      );
    }
    const version = entry.slice(0, sep).trim();
    if (!VERSION_PATTERN.test(version)) {
      throw new KeyringError(`Invalid key version label "${version}".`);
    }
    keys.set(version, parseHexKey(entry.slice(sep + 1), `previous key ${version}`));
  }
  return keys;
}

class Keyring {
  constructor({
    activeKey,
    activeVersion,
    previousKeys = new Map(),
    allowLegacyPlaintext = false,
    legacyDeadline = null,
  }) {
    this.activeKey = activeKey;
    this.activeVersion = activeVersion;
    this.previousKeys = previousKeys;
    this.allowLegacyPlaintext = allowLegacyPlaintext;
    this.legacyDeadline = legacyDeadline;
  }

  keyForVersion(version) {
    if (version === this.activeVersion) return this.activeKey;
    const previous = this.previousKeys.get(version);
    if (previous) return previous;
    throw new KeyringError(
      `No key registered for version "${version}". Add it to IDENTITY_TOTP_PREVIOUS_KEYS to decrypt legacy rows.`,
    );
  }

  /**
   * True when the stored value is plaintext (no version prefix) and the
   * migration window is still open.
   */
  legacyPlaintextAllowed(now = new Date()) {
    if (!this.allowLegacyPlaintext) return false;
    if (!this.legacyDeadline) return true;
    return now < this.legacyDeadline;
  }

  encrypt(plaintext, aad) {
    if (plaintext == null || plaintext === "") return null;
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.activeKey, iv);
    cipher.setAAD(Buffer.from(String(aad)));

    const ciphertext = Buffer.concat([
      cipher.update(String(plaintext), "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      this.activeVersion,
      iv.toString("hex"),
      tag.toString("hex"),
      ciphertext.toString("hex"),
    ].join(":");
  }

  /**
   * Decrypt a stored value. Malformed ciphertext throws — it is never returned
   * as if it were plaintext.
   */
  decrypt(stored, aad, { now = new Date() } = {}) {
    if (stored == null || stored === "") return null;
    const value = String(stored);
    const parts = value.split(":");

    if (parts.length !== 4) {
      // No version envelope: either a pre-encryption row or corruption.
      if (this.legacyPlaintextAllowed(now) && /^[A-Z2-7]+=*$/.test(value)) {
        return value;
      }
      throw new KeyringError(
        "Stored secret is not valid keyring ciphertext and legacy plaintext is not accepted.",
      );
    }

    const [version, ivHex, tagHex, ciphertextHex] = parts;
    if (!VERSION_PATTERN.test(version)) {
      throw new KeyringError(`Malformed ciphertext: invalid version "${version}".`);
    }
    if (
      !/^[0-9a-fA-F]{24}$/.test(ivHex) ||
      !/^[0-9a-fA-F]{32}$/.test(tagHex) ||
      !/^[0-9a-fA-F]*$/.test(ciphertextHex)
    ) {
      throw new KeyringError("Malformed ciphertext: invalid IV, tag, or body encoding.");
    }

    const key = this.keyForVersion(version);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    decipher.setAAD(Buffer.from(String(aad)));

    try {
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextHex, "hex")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Wrong key/version or tampered payload — GCM tag check failed.
      throw new KeyringError(
        `Failed to authenticate secret encrypted with key version "${version}".`,
      );
    }
  }

  /**
   * True when a stored value was encrypted with a non-active key and should be
   * re-encrypted by the rotation migration.
   */
  needsRotation(stored) {
    if (stored == null || stored === "") return false;
    const parts = String(stored).split(":");
    if (parts.length !== 4) return true; // legacy plaintext
    return parts[0] !== this.activeVersion;
  }

  describe() {
    return {
      activeVersion: this.activeVersion,
      previousVersions: [...this.previousKeys.keys()],
      allowLegacyPlaintext: this.allowLegacyPlaintext,
      legacyDeadline: this.legacyDeadline ? this.legacyDeadline.toISOString() : null,
    };
  }
}

/**
 * Build a keyring from a set of `<PREFIX>_ENCRYPTION_KEY` style variables.
 *
 * Production requires both the key and its version. Keys are never derived
 * from IDENTITY_INTERNAL_SECRET — that secret authenticates service-to-service
 * calls, and rotating it would silently destroy every value encrypted with it.
 */
function buildKeyring({ prefix, env = process.env, isProduction, required = true } = {}) {
  const production =
    isProduction === undefined ? env.NODE_ENV === "production" : isProduction;

  const rawKey = env[`${prefix}_ENCRYPTION_KEY`];
  const rawVersion = env[`${prefix}_KEY_VERSION`];

  if (production && required && (!rawKey || !rawVersion)) {
    throw new KeyringError(
      `${prefix}_ENCRYPTION_KEY and ${prefix}_KEY_VERSION are required in production.`,
    );
  }

  let activeKey;
  let activeVersion;

  if (rawKey) {
    activeKey = parseHexKey(rawKey, `${prefix}_ENCRYPTION_KEY`);
    activeVersion = String(rawVersion || "v1").trim();
    if (!VERSION_PATTERN.test(activeVersion)) {
      throw new KeyringError(
        `${prefix}_KEY_VERSION "${activeVersion}" must match ${VERSION_PATTERN}.`,
      );
    }
  } else {
    // Dev/test only: a per-process key, and an obviously non-production label.
    activeKey = crypto.randomBytes(KEY_BYTES);
    activeVersion = "dev";
  }

  const legacyDeadlineRaw = env[`${prefix}_LEGACY_DEADLINE`];
  let legacyDeadline = null;
  if (legacyDeadlineRaw) {
    const parsed = new Date(legacyDeadlineRaw);
    if (Number.isNaN(parsed.getTime())) {
      throw new KeyringError(`${prefix}_LEGACY_DEADLINE must be a valid ISO date.`);
    }
    legacyDeadline = parsed;
  }

  const allowLegacyPlaintext =
    env[`${prefix}_ALLOW_LEGACY_PLAINTEXT`] === "true" ||
    env[`${prefix}_ALLOW_LEGACY_PLAINTEXT`] === "1";

  if (production && allowLegacyPlaintext && !legacyDeadline) {
    throw new KeyringError(
      `${prefix}_ALLOW_LEGACY_PLAINTEXT requires ${prefix}_LEGACY_DEADLINE in production.`,
    );
  }

  return new Keyring({
    activeKey,
    activeVersion,
    previousKeys: parsePreviousKeys(env[`${prefix}_PREVIOUS_KEYS`]),
    allowLegacyPlaintext,
    legacyDeadline,
  });
}

function buildTotpKeyring(opts = {}) {
  return buildKeyring({ prefix: "IDENTITY_TOTP", required: true, ...opts });
}

/**
 * Keyring protecting secrets parked in the durable outbox (email verification
 * tokens, reset OTPs). Those rows live long enough to appear in a database
 * dump, so the payload is encrypted at rest and only decrypted by the
 * publisher immediately before the event goes onto the broker.
 */
function buildOutboxKeyring(opts = {}) {
  return buildKeyring({ prefix: "IDENTITY_OUTBOX_PAYLOAD", required: false, ...opts });
}

const cache = new Map();

function getTotpKeyring() {
  if (!cache.has("totp")) cache.set("totp", buildTotpKeyring());
  return cache.get("totp");
}

function getOutboxKeyring() {
  if (!cache.has("outbox")) cache.set("outbox", buildOutboxKeyring());
  return cache.get("outbox");
}

/** Test/rotation hook — forces the next access to re-read the env. */
function resetKeyrings() {
  cache.clear();
}

module.exports = {
  Keyring,
  KeyringError,
  buildKeyring,
  buildTotpKeyring,
  buildOutboxKeyring,
  getTotpKeyring,
  getOutboxKeyring,
  resetKeyrings,
  resetTotpKeyring: resetKeyrings,
  parseHexKey,
  parsePreviousKeys,
  KEY_BYTES,
};
