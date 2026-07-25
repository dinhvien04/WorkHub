"use strict";

const crypto = require("crypto");
const fs = require("fs");

let activeKey = null;

function initKeys() {
  if (activeKey) return activeKey;

  let privateKeyPem = process.env.IDENTITY_JWT_PRIVATE_KEY;
  let kid = process.env.IDENTITY_JWT_ACTIVE_KID || "key-v1";

  if (process.env.IDENTITY_JWT_PRIVATE_KEY_FILE) {
    try {
      privateKeyPem = fs.readFileSync(process.env.IDENTITY_JWT_PRIVATE_KEY_FILE, "utf8");
    } catch (err) {
      console.error("[KeyManager] Failed to read private key file:", err.message);
    }
  }

  if (!privateKeyPem) {
    // Dynamic generation for tests & dev
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });
    activeKey = {
      privateKey: keyPem,
      publicKey: publicKey,
      jwk: publicKey.export({ format: "jwk" }),
      kid,
    };
    return activeKey;
  }

  // Parse existing PEM private key to extract public key and JWK
  const privateKeyObj = crypto.createPrivateKey(privateKeyPem);
  const publicKeyObj = crypto.createPublicKey(privateKeyObj);
  activeKey = {
    privateKey: privateKeyPem,
    publicKey: publicKeyObj,
    jwk: publicKeyObj.export({ format: "jwk" }),
    kid,
  };
  return activeKey;
}

function getActiveKey() {
  return initKeys();
}

function getJwks() {
  const key = getActiveKey();
  return {
    keys: [
      {
        kty: key.jwk.kty,
        n: key.jwk.n,
        e: key.jwk.e,
        use: "sig",
        alg: "RS256",
        kid: key.kid,
      }
    ]
  };
}

module.exports = {
  getActiveKey,
  getJwks,
};
