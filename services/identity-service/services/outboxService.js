"use strict";

const emailService = require("./emailService");
const logActivity = require("../utils/auditLogger");

/**
 * Compatibility shim so authController can call outbox helpers.
 * Identity-service currently dispatches immediately (no durable outbox table yet).
 */
async function enqueueSecureVerifyEmail({ to, userId, rawToken, subject }, _opts = {}) {
  await emailService.sendGeneric({
    to,
    subject: subject || "Xác minh email WorkHub",
    text: `Mã xác minh email WorkHub: ${rawToken}\nHết hạn sau 24 giờ.`,
  });
  return { ok: true, userId };
}

async function enqueueAudit(
  { userId, action, entityType, entityId, message, level = "info" },
  _opts = {},
) {
  return logActivity(userId, action, entityType, entityId, message, level);
}

module.exports = {
  enqueueSecureVerifyEmail,
  enqueueAudit,
};
