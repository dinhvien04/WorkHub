const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

const SENSITIVE = /password|token|secret|banknumber|bank_number|authorization/i;

function sanitizeDescription(description) {
  let text = String(description || '');
  if (SENSITIVE.test(text)) {
    text = text.replace(/(password|token|secret|bankNumber|BankNumber)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
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

async function logActivity(actorId, actionType, targetEntity, targetId, description, _severity = 'info') {
  try {
    const entityKey = String(targetEntity || 'System');
    const mapped =
      ENTITY_MAP[entityKey] ||
      ENTITY_MAP[entityKey.toUpperCase()] ||
      (['Booking', 'Branch', 'CustomerProfile', 'HostProfile', 'PaymentHistory', 'Review', 'Space', 'User', 'System'].includes(entityKey)
        ? entityKey
        : 'System');

    await AuditLog.create({
      ActorID: actorId || null,
      ActionType: actionType,
      TargetEntity: mapped,
      TargetID: targetId || null,
      Description: sanitizeDescription(description),
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

module.exports = logActivity;