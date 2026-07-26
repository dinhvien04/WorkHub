"use strict";

/**
 * RS256 signing keyring for identity-issued access tokens.
 *
 * Tokens are signed with the active key only. Verification accepts the active
 * key plus any key in the overlap set, looked up by the `kid` header — so a
 * rotation is: publish the new key as active, move the old one to
 * IDENTITY_JWT_PREVIOUS_PUBLIC_KEYS for one token lifetime, then retire it.
 *
 * Production must supply a persistent key. Generating one at boot would mean
 * every restart silently invalidates all outstanding tokens and breaks JWKS
 * consumers that cached the previous modulus.
 *
 * Env:
 *   IDENTITY_JWT_ACTIVE_KID              label for the active key, e.g. "key-2026-07"
 *   IDENTITY_JWT_PRIVATE_KEY             active private key PEM (PKCS#8)
 *   IDENTITY_JWT_PRIVATE_KEY_FILE        path to the same, preferred for secret mounts
 *   IDENTITY_JWT_PREVIOUS_PUBLIC_KEYS    "kid:<base64 PEM>,kid2:<base64 PEM>" — verify only
 *   IDENTITY_JWT_RETIRED_KIDS            "kid,kid2" — always rejected, even if presented
 */
const crypto = require("crypto");
const fs = require("fs");

const KID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

class KeyManagerError extends Error {
  constructor(message) {
    super(message);
    this.name = "KeyManagerError";
  }
}

function jwkThumbprintFields(publicKeyObject) {
  const jwk = publicKeyObject.export({ format: "jwk" });
  return { kty: jwk.kty, n: jwk.n, e: jwk.e };
}

/**
 * Parse "kid:<base64 PEM>,kid2:<base64 PEM>" into verification-only entries.
 */
function parsePreviousPublicKeys(raw) {
  const entries = new Map();
  const items = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const item of items) {
    const sep = item.indexOf(":");
    if (sep <= 0) {
      throw new KeyManagerError(
        `IDENTITY_JWT_PREVIOUS_PUBLIC_KEYS entry "${item}" must use "<kid>:<base64 PEM>" form.`,
      );
    }
    const kid = item.slice(0, sep).trim();
    if (!KID_PATTERN.test(kid)) {
      throw new KeyManagerError(`Invalid previous key id "${kid}".`);
    }

    let pem;
    try {
      pem = Buffer.from(item.slice(sep + 1).trim(), "base64").toString("utf8");
    } catch {
      throw new KeyManagerError(`Previous key "${kid}" is not valid base64.`);
    }

    let publicKey;
    try {
      publicKey = crypto.createPublicKey(pem);
    } catch (err) {
      throw new KeyManagerError(
        `Previous key "${kid}" is not a readable public key: ${err.message}`,
      );
    }

    entries.set(kid, { kid, publicKey, jwk: jwkThumbprintFields(publicKey) });
  }
  return entries;
}

function loadActivePrivateKey(env) {
  if (env.IDENTITY_JWT_PRIVATE_KEY_FILE) {
    try {
      return fs.readFileSync(env.IDENTITY_JWT_PRIVATE_KEY_FILE, "utf8");
    } catch (err) {
      throw new KeyManagerError(
        `Failed to read IDENTITY_JWT_PRIVATE_KEY_FILE (${env.IDENTITY_JWT_PRIVATE_KEY_FILE}): ${err.message}`,
      );
    }
  }
  return env.IDENTITY_JWT_PRIVATE_KEY || null;
}

class SigningKeyring {
  constructor({ active, previous = new Map(), retiredKids = new Set(), ephemeral = false }) {
    this.active = active;
    this.previous = previous;
    this.retiredKids = retiredKids;
    this.ephemeral = ephemeral;
    this._jwksCache = null;
  }

  getActiveKey() {
    return this.active;
  }

  /**
   * Resolve a verification key by `kid`.
   *
   * A token with no kid is only accepted when the keyring holds exactly one
   * key (single-key deployments and tests); otherwise the caller must present
   * one so rotation stays unambiguous.
   */
  getVerificationKey(kid) {
    if (kid && this.retiredKids.has(kid)) {
      throw new KeyManagerError(`Key "${kid}" has been retired.`);
    }
    if (!kid) {
      if (this.previous.size === 0) return this.active;
      throw new KeyManagerError("Token is missing a kid header.");
    }
    if (kid === this.active.kid) return this.active;

    const previous = this.previous.get(kid);
    if (previous) return previous;

    throw new KeyManagerError(`Unknown key id "${kid}".`);
  }

  /**
   * JWKS document plus a strong ETag derived from its content, so rotation
   * changes the ETag and nothing else has to be invalidated by hand.
   */
  getJwks() {
    if (this._jwksCache) return this._jwksCache;

    const toJwk = (entry) => ({
      kty: entry.jwk.kty,
      n: entry.jwk.n,
      e: entry.jwk.e,
      use: "sig",
      alg: "RS256",
      kid: entry.kid,
    });

    const keys = [toJwk(this.active)];
    for (const entry of this.previous.values()) {
      if (this.retiredKids.has(entry.kid)) continue;
      keys.push(toJwk(entry));
    }

    const document = { keys };
    const etag = `"${crypto
      .createHash("sha256")
      .update(JSON.stringify(document))
      .digest("base64url")}"`;

    this._jwksCache = { document, etag };
    return this._jwksCache;
  }

  describe() {
    return {
      activeKid: this.active.kid,
      previousKids: [...this.previous.keys()],
      retiredKids: [...this.retiredKids],
      ephemeral: this.ephemeral,
    };
  }
}

function buildSigningKeyring({ env = process.env, isProduction } = {}) {
  const production =
    isProduction === undefined ? env.NODE_ENV === "production" : isProduction;

  const privateKeyPem = loadActivePrivateKey(env);
  const kid = String(env.IDENTITY_JWT_ACTIVE_KID || "").trim();

  const retiredKids = new Set(
    String(env.IDENTITY_JWT_RETIRED_KIDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const previous = parsePreviousPublicKeys(env.IDENTITY_JWT_PREVIOUS_PUBLIC_KEYS);

  if (!privateKeyPem) {
    if (production) {
      throw new KeyManagerError(
        "IDENTITY_JWT_PRIVATE_KEY or IDENTITY_JWT_PRIVATE_KEY_FILE is required in production. " +
          "Refusing to generate an ephemeral signing key, which would invalidate every token on restart.",
      );
    }

    // Dev/test only.
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const active = {
      kid: kid || "dev-key",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
      publicKey,
      jwk: jwkThumbprintFields(publicKey),
    };
    return new SigningKeyring({ active, previous, retiredKids, ephemeral: true });
  }

  if (production && !kid) {
    throw new KeyManagerError("IDENTITY_JWT_ACTIVE_KID is required in production.");
  }
  const activeKid = kid || "key-v1";
  if (!KID_PATTERN.test(activeKid)) {
    throw new KeyManagerError(`IDENTITY_JWT_ACTIVE_KID "${activeKid}" is not a valid key id.`);
  }
  if (retiredKids.has(activeKid)) {
    throw new KeyManagerError(
      `Active key "${activeKid}" is also listed in IDENTITY_JWT_RETIRED_KIDS.`,
    );
  }

  let privateKeyObject;
  try {
    privateKeyObject = crypto.createPrivateKey(privateKeyPem);
  } catch (err) {
    throw new KeyManagerError(`Active signing key is not a readable private key: ${err.message}`);
  }
  if (privateKeyObject.asymmetricKeyType !== "rsa") {
    throw new KeyManagerError(
      `Active signing key must be RSA for RS256, got "${privateKeyObject.asymmetricKeyType}".`,
    );
  }
  const modulusBits = privateKeyObject.asymmetricKeyDetails?.modulusLength;
  if (modulusBits && modulusBits < 2048) {
    throw new KeyManagerError(`Active signing key must be at least 2048 bits, got ${modulusBits}.`);
  }

  const publicKeyObject = crypto.createPublicKey(privateKeyObject);
  const active = {
    kid: activeKid,
    privateKey: privateKeyPem,
    publicKey: publicKeyObject,
    jwk: jwkThumbprintFields(publicKeyObject),
  };

  return new SigningKeyring({ active, previous, retiredKids, ephemeral: false });
}

let cached = null;

function getKeyring() {
  if (!cached) cached = buildSigningKeyring();
  return cached;
}

function getActiveKey() {
  return getKeyring().getActiveKey();
}

function getVerificationKey(kid) {
  return getKeyring().getVerificationKey(kid);
}

function getJwks() {
  return getKeyring().getJwks().document;
}

function getJwksWithEtag() {
  return getKeyring().getJwks();
}

/** Test/rotation hook — forces the next access to re-read the env. */
function reset() {
  cached = null;
}

module.exports = {
  KeyManagerError,
  SigningKeyring,
  buildSigningKeyring,
  getKeyring,
  getActiveKey,
  getVerificationKey,
  getJwks,
  getJwksWithEtag,
  reset,
  parsePreviousPublicKeys,
};
