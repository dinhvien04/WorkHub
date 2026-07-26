"use strict";

/**
 * Transactional outbox for identity.
 *
 * Every helper here takes an optional Mongo `session` and writes its row inside
 * the caller's transaction. Nothing in this module talks to RabbitMQ or to an
 * email provider — publishing is the outbox worker's job, and email delivery
 * belongs to Communication Service. That separation is what makes the
 * "state change committed but the notification vanished" failure impossible.
 */
const crypto = require("crypto");
const IdentityOutbox = require("../models/IdentityOutbox");
const IdentityAuditLog = require("../models/AuditLog");
const env = require("../config/env");
const { getOutboxKeyring } = require("./keyring");

const PRODUCER = "identity-service";

/**
 * Event types whose payload holds a single-use secret. These are stored as
 * ciphertext in the outbox and only decrypted by the publisher.
 */
const SECRET_EVENT_TYPES = new Set(["identity.email-requested.v1"]);

function buildEnvelope({
  eventType,
  aggregateId,
  data,
  aggregateVersion = 0,
  correlationId,
  causationId,
  traceId,
}) {
  const envelope = {
    eventId: crypto.randomUUID(),
    eventType,
    occurredAt: new Date().toISOString(),
    producer: PRODUCER,
    aggregateId: String(aggregateId),
    aggregateVersion: Number.isInteger(aggregateVersion) && aggregateVersion >= 0
      ? aggregateVersion
      : 0,
    correlationId: correlationId || crypto.randomUUID(),
    data: data || {},
  };
  if (causationId) envelope.causationId = causationId;
  if (traceId) envelope.traceId = traceId;
  return envelope;
}

/**
 * Append an event to the outbox.
 *
 * `idempotencyKey` is unique-indexed: re-running the same logical operation
 * (a retried request, a replayed saga step) inserts nothing the second time
 * rather than emitting a duplicate event.
 */
async function enqueueEvent(
  {
    eventType,
    aggregateId,
    data,
    aggregateVersion = 0,
    idempotencyKey,
    correlationId,
    causationId,
    traceId,
  },
  { session } = {},
) {
  if (!eventType) throw new Error("enqueueEvent requires an eventType.");
  if (!aggregateId) throw new Error("enqueueEvent requires an aggregateId.");
  if (!idempotencyKey) throw new Error("enqueueEvent requires an idempotencyKey.");

  const envelope = buildEnvelope({
    eventType,
    aggregateId,
    data,
    aggregateVersion,
    correlationId,
    causationId,
    traceId,
  });

  const row = {
    EventId: envelope.eventId,
    EventType: eventType,
    AggregateId: String(aggregateId),
    IdempotencyKey: idempotencyKey,
    MaxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    AvailableAt: new Date(),
  };

  if (SECRET_EVENT_TYPES.has(eventType)) {
    // AAD binds the ciphertext to this row, so a payload cannot be moved onto
    // a different outbox entry.
    row.CipherPayload = getOutboxKeyring().encrypt(
      JSON.stringify(envelope),
      envelope.eventId,
    );
    row.Payload = null;
  } else {
    row.Payload = envelope;
    row.CipherPayload = null;
  }

  try {
    if (session) {
      const [created] = await IdentityOutbox.create([row], { session });
      return created;
    }
    return await IdentityOutbox.create(row);
  } catch (err) {
    if (err.code === 11000) {
      // Same logical operation already enqueued — treat as success.
      const existing = await IdentityOutbox.findOne({ IdempotencyKey: idempotencyKey });
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * Read an outbox row's event envelope, decrypting it when necessary.
 */
function readEnvelope(row) {
  if (row.CipherPayload) {
    const plaintext = getOutboxKeyring().decrypt(row.CipherPayload, row.EventId);
    return JSON.parse(plaintext);
  }
  return row.Payload;
}

// —— Convenience wrappers ——

/**
 * Ask Communication Service to deliver a transactional email.
 *
 * The secret (verification token, reset OTP) travels inside `data` and is
 * encrypted at rest by enqueueEvent.
 */
async function enqueueEmail(
  { userId, toEmail, template, data = {}, idempotencyKey, correlationId },
  { session } = {},
) {
  return enqueueEvent(
    {
      eventType: "identity.email-requested.v1",
      aggregateId: userId ? String(userId) : String(toEmail),
      idempotencyKey,
      correlationId,
      data: {
        ...(userId ? { userId: String(userId) } : {}),
        toEmail: String(toEmail),
        template,
        data,
        requestedAt: new Date().toISOString(),
      },
    },
    { session },
  );
}

async function enqueueUserCreated(user, { session, correlationId } = {}) {
  return enqueueEvent(
    {
      eventType: "identity.user-created.v1",
      aggregateId: user._id,
      aggregateVersion: user.tokenVersion || 0,
      idempotencyKey: `user-created:${user._id}`,
      correlationId,
      data: {
        userId: String(user._id),
        email: user.Email,
        fullName: user.FullName,
        role: user.Role,
        status: user.Status,
        tokenVersion: user.tokenVersion || 0,
      },
    },
    { session },
  );
}

async function enqueueEmailVerified(user, { session, correlationId } = {}) {
  return enqueueEvent(
    {
      eventType: "identity.email-verified.v1",
      aggregateId: user._id,
      aggregateVersion: user.tokenVersion || 0,
      idempotencyKey: `email-verified:${user._id}:${user.tokenVersion || 0}`,
      correlationId,
      data: {
        userId: String(user._id),
        email: user.Email,
        verifiedAt: new Date().toISOString(),
      },
    },
    { session },
  );
}

async function enqueuePasswordChanged(user, { session, correlationId } = {}) {
  return enqueueEvent(
    {
      eventType: "identity.password-changed.v1",
      aggregateId: user._id,
      aggregateVersion: user.tokenVersion || 0,
      idempotencyKey: `password-changed:${user._id}:${user.tokenVersion || 0}`,
      correlationId,
      data: {
        userId: String(user._id),
        changedAt: new Date().toISOString(),
      },
    },
    { session },
  );
}

async function enqueueMfaChanged(user, mfaEnabled, { session, correlationId } = {}) {
  return enqueueEvent(
    {
      eventType: "identity.mfa-changed.v1",
      aggregateId: user._id,
      aggregateVersion: user.tokenVersion || 0,
      idempotencyKey: `mfa-changed:${user._id}:${mfaEnabled}:${Date.now()}`,
      correlationId,
      data: {
        userId: String(user._id),
        mfaEnabled: !!mfaEnabled,
        mfaType: "totp",
      },
    },
    { session },
  );
}

async function enqueueUserStatusChanged(user, { session, correlationId } = {}) {
  return enqueueEvent(
    {
      eventType: "identity.user-status-changed.v1",
      aggregateId: user._id,
      aggregateVersion: user.tokenVersion || 0,
      idempotencyKey: `user-status:${user._id}:${user.Status}:${user.tokenVersion || 0}`,
      correlationId,
      data: { userId: String(user._id), status: user.Status },
    },
    { session },
  );
}

async function enqueueSessionCreated(
  { user, sessionId, publicSessionId, authMethod, expiresAt },
  { session, correlationId } = {},
) {
  return enqueueEvent(
    {
      eventType: "identity.session-created.v1",
      aggregateId: user._id,
      aggregateVersion: user.tokenVersion || 0,
      idempotencyKey: `session-created:${publicSessionId}`,
      correlationId,
      data: {
        userId: String(user._id),
        sessionId: String(sessionId),
        publicSessionId: String(publicSessionId),
        authMethod: String(authMethod),
        expiresAt: new Date(expiresAt).toISOString(),
      },
    },
    { session },
  );
}

async function enqueueSessionRevoked(
  { userId, sessionId, publicSessionId },
  { session, correlationId } = {},
) {
  return enqueueEvent(
    {
      eventType: "identity.session-revoked.v1",
      aggregateId: userId,
      idempotencyKey: `session-revoked:${publicSessionId}`,
      correlationId,
      data: {
        userId: String(userId),
        sessionId: String(sessionId),
        publicSessionId: String(publicSessionId),
        revokedAt: new Date().toISOString(),
      },
    },
    { session },
  );
}

async function enqueueAllSessionsRevoked(
  { userId, tokenVersion },
  { session, correlationId } = {},
) {
  return enqueueEvent(
    {
      eventType: "identity.all-sessions-revoked.v1",
      aggregateId: userId,
      aggregateVersion: tokenVersion || 0,
      idempotencyKey: `all-sessions-revoked:${userId}:${tokenVersion || 0}`,
      correlationId,
      data: {
        userId: String(userId),
        revokedAt: new Date().toISOString(),
        tokenVersion: tokenVersion || 0,
      },
    },
    { session },
  );
}

/**
 * Durable audit entry, written in the caller's transaction.
 *
 * Identity owns its audit trail, so this is a local collection rather than an
 * event — there is no downstream consumer that should be able to lose it.
 */
async function enqueueAudit(
  { userId, action, entityType, entityId, message, level = "info", req = null },
  { session } = {},
) {
  const row = {
    UserID: userId || null,
    Action: action,
    EntityType: entityType || null,
    EntityID: entityId ? String(entityId) : null,
    Message: message || "",
    Level: level,
    IP: req ? String(req.ip || "").slice(0, 64) : "",
    UserAgent: req ? String(req.get("user-agent") || "").slice(0, 300) : "",
    OccurredAt: new Date(),
  };

  if (session) {
    const [created] = await IdentityAuditLog.create([row], { session });
    return created;
  }
  return IdentityAuditLog.create(row);
}

module.exports = {
  PRODUCER,
  SECRET_EVENT_TYPES,
  buildEnvelope,
  enqueueEvent,
  readEnvelope,
  enqueueEmail,
  enqueueUserCreated,
  enqueueEmailVerified,
  enqueuePasswordChanged,
  enqueueMfaChanged,
  enqueueUserStatusChanged,
  enqueueSessionCreated,
  enqueueSessionRevoked,
  enqueueAllSessionsRevoked,
  enqueueAudit,
};
