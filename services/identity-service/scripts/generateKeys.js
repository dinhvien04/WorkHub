"use strict";

/**
 * Print a fresh set of identity-service production secrets.
 *
 * Usage: npm run keys:generate --workspace=@workhub/identity-service
 *
 * Nothing here is written to disk or logged anywhere else — copy the output
 * into your secret manager and discard the terminal buffer.
 */
const crypto = require("crypto");

function hex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 3072,
});

const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const kid = `key-${new Date().toISOString().slice(0, 7)}-${crypto.randomBytes(3).toString("hex")}`;

console.log(`
# —— identity-service signing key (RS256) ——
IDENTITY_JWT_ACTIVE_KID=${kid}
# Store the PEM itself in a secret file and point at it:
#   IDENTITY_JWT_PRIVATE_KEY_FILE=/run/secrets/identity_jwt_private_key
# During rotation, publish the OUTGOING key's public half here for one token
# lifetime so tokens signed with it still verify:
#   IDENTITY_JWT_PREVIOUS_PUBLIC_KEYS=<old-kid>:${Buffer.from(publicPem).toString("base64").slice(0, 24)}...

# —— symmetric secrets ——
IDENTITY_PREAUTH_JWT_SECRET=${hex(32)}
IDENTITY_CSRF_SECRET=${hex(32)}
PASSWORD_RESET_PEPPER=${hex(32)}
IDENTITY_INTERNAL_SECRET=${hex(32)}

# —— TOTP seed encryption ——
IDENTITY_TOTP_ENCRYPTION_KEY=${hex(32)}
IDENTITY_TOTP_KEY_VERSION=v1

# —— outbox payload encryption ——
IDENTITY_OUTBOX_PAYLOAD_ENCRYPTION_KEY=${hex(32)}
IDENTITY_OUTBOX_PAYLOAD_KEY_VERSION=v1
`);

console.log("# —— private key PEM (do not commit) ——");
console.log(privatePem);
console.log(`# public half, base64 for IDENTITY_JWT_PREVIOUS_PUBLIC_KEYS on the next rotation:`);
console.log(`# ${kid}:${Buffer.from(publicPem).toString("base64")}`);
