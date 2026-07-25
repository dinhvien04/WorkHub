"use strict";

const logger = require("./logger");

/**
 * Identity-service audit sink.
 * Emits structured logs now; can publish to AMQP/outbox later.
 */
async function logActivity(userId, action, entityType, entityId, message, level = "info") {
  const payload = {
    userId: userId ? String(userId) : null,
    action,
    entityType,
    entityId: entityId ? String(entityId) : null,
    message,
    level,
    at: new Date().toISOString(),
  };
  if (level === "error") logger.error("[audit]", payload);
  else if (level === "warning") logger.warn("[audit]", payload);
  else logger.info("[audit]", payload);
  return payload;
}

module.exports = logActivity;
