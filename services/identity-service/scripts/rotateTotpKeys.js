"use strict";

/**
 * Re-encrypt every TOTP seed under the current active key.
 *
 * Usage:
 *   # 1. Promote the new key, keep the old one available for decryption:
 *   IDENTITY_TOTP_ENCRYPTION_KEY=<new hex>  IDENTITY_TOTP_KEY_VERSION=v2 \
 *   IDENTITY_TOTP_PREVIOUS_KEYS=v1:<old hex> \
 *   npm run rotate:totp-keys --workspace=@workhub/identity-service -- --dry-run
 *
 *   # 2. Re-run without --dry-run, then drop v1 from IDENTITY_TOTP_PREVIOUS_KEYS.
 *
 * Safe to re-run: rows already on the active version are skipped, and each
 * seed is verified to decrypt correctly before its replacement is written.
 */
const mongoose = require("mongoose");
const env = require("../config/env");
const User = require("../models/User");
const totpService = require("../services/totpService");
const { getTotpKeyring } = require("../services/keyring");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const keyring = getTotpKeyring();
  console.log("[RotateTotp] Keyring:", JSON.stringify(keyring.describe()));
  if (DRY_RUN) console.log("[RotateTotp] DRY RUN — no writes will be made.");

  await mongoose.connect(env.MONGODB_IDENTITY_URI);
  console.log("[RotateTotp] Connected to", env.MONGODB_IDENTITY_URI);

  const cursor = User.find({ TotpSecret: { $ne: null } })
    .select("+TotpSecret _id Email")
    .cursor();

  const stats = { scanned: 0, alreadyCurrent: 0, rotated: 0, failed: 0 };

  for await (const user of cursor) {
    stats.scanned++;
    if (!user.TotpSecret) continue;

    if (!totpService.needsRotation(user.TotpSecret)) {
      stats.alreadyCurrent++;
      continue;
    }

    const decrypted = totpService.tryDecryptSecret(user.TotpSecret, user._id);
    if (!decrypted.ok) {
      stats.failed++;
      console.error(`[RotateTotp] FAILED ${user._id} (${user.Email}): ${decrypted.error}`);
      continue;
    }

    const reEncrypted = totpService.encryptSecret(decrypted.secret, user._id);

    // Verify the new ciphertext round-trips before persisting it — a bad write
    // here would lock the user out of their own account.
    const check = totpService.tryDecryptSecret(reEncrypted, user._id);
    if (!check.ok || check.secret !== decrypted.secret) {
      stats.failed++;
      console.error(`[RotateTotp] FAILED verification for ${user._id}; leaving row untouched.`);
      continue;
    }

    if (!DRY_RUN) {
      await User.updateOne({ _id: user._id }, { $set: { TotpSecret: reEncrypted } });
    }
    stats.rotated++;
  }

  console.log("[RotateTotp] Done:", JSON.stringify(stats));
  await mongoose.disconnect();

  if (stats.failed > 0) {
    console.error("[RotateTotp] Some rows could not be rotated. Investigate before retiring the old key.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[RotateTotp] Fatal:", err.message);
  process.exit(1);
});
