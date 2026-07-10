'use strict';

const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

const SENSITIVE =
  /password|token|secret|banknumber|bank_number|authorization|otp|cookie|apikey|api_key|privatekey|private_key/i;

/**
 * Redact sensitive keys from a plain object (before/after audit diffs).
 */
function redactValue(key, value, depth = 0) {
  if (depth > 4) return '[Truncated]';
  if (value == null) return value;
  if (SENSITIVE.test(String(key || ''))) return '[REDACTED]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v, i) => redactValue(i, v, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(k, v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}…`;
  }
  return value;
}

function redactObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  return redactValue('', obj);
}

function sanitizeDescription(description) {
  let text = String(description || '');
  if (SENSITIVE.test(text)) {
    text = text.replace(
      /(password|token|secret|bankNumber|BankNumber|otp|api[_-]?key)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]'
    );
  }
  return text.slice(0, 2000);
}

const ENTITY_MAP = {
  USER: 'User',
  user: 'User',
  BOOKING: 'Booking',
  PAYMENTHISTORY: 'PaymentHistory',
  PAYMENT: 'PaymentHistory',
  HOSTPROFILE: 'HostProfile',
  CUSTOMERPROFILE: 'CustomerProfile',
  BRANCH: 'Branch',
  SPACE: 'Space',
  REVIEW: 'Review',
  SYSTEM: 'System',
};

/**
 * @param {object} [diff] optional { before, after } — stored redacted in Description JSON tail
 */
async function logActivity(
  actorId,
  actionType,
  targetEntity,
  targetId,
  description,
  _severity = 'info',
  diff = null
) {
  try {
    const entityKey = String(targetEntity || 'System');
    const mapped =
      ENTITY_MAP[entityKey] ||
      ENTITY_MAP[entityKey.toUpperCase()] ||
      ([
        'Booking',
        'Branch',
        'CustomerProfile',
        'HostProfile',
        'PaymentHistory',
        'Review',
        'Space',
        'User',
        'System',
      ].includes(entityKey)
        ? entityKey
        : 'System');

    let desc = sanitizeDescription(description);
    if (diff && (diff.before !== undefined || diff.after !== undefined)) {
      const payload = {
        before: redactObject(diff.before),
        after: redactObject(diff.after),
      };
      const tail = JSON.stringify(payload).slice(0, 1500);
      desc = `${desc} | diff=${tail}`.slice(0, 2000);
    }

    await AuditLog.create({
      ActorID: actorId || null,
      ActionType: actionType,
      TargetEntity: mapped,
      TargetID: targetId || null,
      Description: desc,
    });
    try {
      const { emitAuditLog } = require('../services/socketService');
      emitAuditLog({ message: 'Hệ thống vừa có hoạt động mới!' });
    } catch {
      /* socket optional */
    }
  } catch (error) {
    logger.error('AuditLog failed (non-fatal):', error.message);
  }
}

logActivity.redactObject = redactObject;
logActivity.sanitizeDescription = sanitizeDescription;

module.exports = logActivity;
