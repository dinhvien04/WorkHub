'use strict';

/**
 * Lightweight alert dispatcher for ops thresholds.
 * Configure ALERT_WEBHOOK_URL for Slack/Discord/generic webhook.
 */
const logger = require('../utils/logger');
const env = require('../config/env');

const recent = [];
const MAX_RECENT = 100;

async function sendAlert({ level = 'warning', code, message, meta = {} }) {
  const event = {
    level,
    code: String(code || 'ALERT'),
    message: String(message || '').slice(0, 500),
    meta,
    at: new Date().toISOString(),
  };
  recent.unshift(event);
  if (recent.length > MAX_RECENT) recent.pop();

  logger.warn({ alert: event }, `ALERT ${event.code}: ${event.message}`);

  const url = process.env.ALERT_WEBHOOK_URL || '';
  if (!url || env.isTest) return event;

  try {
    await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[WorkHub ${event.level}] ${event.code}: ${event.message}`,
        ...event,
      }),
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Alert webhook failed');
  }
  return event;
}

function listRecent(limit = 20) {
  return recent.slice(0, Math.min(50, limit));
}

/** Evaluate simple metric rules (called from health/jobs). */
async function evaluateHealthAlerts(snapshot = {}) {
  const alerts = [];
  if (snapshot.dbReadyState != null && snapshot.dbReadyState !== 1) {
    alerts.push(
      await sendAlert({
        level: 'critical',
        code: 'DB_DISCONNECT',
        message: 'MongoDB not ready',
        meta: { readyState: snapshot.dbReadyState },
      })
    );
  }
  if (snapshot.errorRate5m != null && snapshot.errorRate5m > 0.05) {
    alerts.push(
      await sendAlert({
        level: 'warning',
        code: 'ERROR_SPIKE',
        message: `HTTP error rate ${(snapshot.errorRate5m * 100).toFixed(1)}%`,
        meta: snapshot,
      })
    );
  }
  if (snapshot.queueBacklog != null && snapshot.queueBacklog > 100) {
    alerts.push(
      await sendAlert({
        level: 'warning',
        code: 'QUEUE_BACKLOG',
        message: `Job queue backlog ${snapshot.queueBacklog}`,
        meta: snapshot,
      })
    );
  }
  return alerts;
}

module.exports = { sendAlert, listRecent, evaluateHealthAlerts };
