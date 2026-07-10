'use strict';

const logger = require('../utils/logger');
const env = require('../config/env');

const outbox = [];

async function sendViaResend({ to, subject, text }) {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  // Node 18+ global fetch
  const res = await globalThis.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend failed: ${res.status} ${body}`);
  }
  return { ok: true, provider: 'resend' };
}

/**
 * Send password reset OTP.
 * - development/test without provider: store in memory outbox (never log OTP).
 * - production: requires EMAIL_PROVIDER config; fail if send fails.
 */
async function sendPasswordResetOtp({ to, otp }) {
  const payload = {
    to,
    subject: 'WorkHub password reset',
    body: `Your password reset code is: ${otp}`,
    createdAt: new Date(),
  };

  if (env.isProduction) {
    if (!env.EMAIL_PROVIDER || !env.EMAIL_FROM) {
      throw new Error(
        'Email provider is not configured for production (EMAIL_PROVIDER, EMAIL_FROM).'
      );
    }
    if (env.EMAIL_PROVIDER === 'resend') {
      await sendViaResend({ to, subject: payload.subject, text: payload.body });
      logger.info(`Password reset email dispatched to ${to}`);
      return { ok: true, provider: 'resend' };
    }
    throw new Error(`Unsupported EMAIL_PROVIDER: ${env.EMAIL_PROVIDER}`);
  }

  // Dev / test only
  outbox.push(payload);
  logger.info(`[DEV EMAIL] password reset queued for ${to} (OTP not logged)`);
  return { ok: true, provider: 'dev-outbox' };
}

function getLastDevEmail() {
  return outbox[outbox.length - 1] || null;
}

function clearDevOutbox() {
  outbox.length = 0;
}

function peekLastOtp() {
  if (env.isProduction) return null;
  const last = getLastDevEmail();
  if (!last || !last.body) return null;
  const m = last.body.match(/code is: (\d+)/);
  return m ? m[1] : null;
}

async function sendGeneric({ to, subject, text }) {
  const payload = {
    to,
    subject: subject || 'WorkHub',
    body: text || '',
    createdAt: new Date(),
  };
  if (env.isProduction) {
    if (!env.EMAIL_PROVIDER || !env.EMAIL_FROM) {
      throw new Error('Email provider is not configured for production.');
    }
    if (env.EMAIL_PROVIDER === 'resend') {
      await sendViaResend({ to, subject: payload.subject, text: payload.body });
      return { ok: true, provider: 'resend' };
    }
    throw new Error(`Unsupported EMAIL_PROVIDER: ${env.EMAIL_PROVIDER}`);
  }
  outbox.push(payload);
  logger.info(`[DEV EMAIL] queued for ${to}: ${payload.subject}`);
  return { ok: true, provider: 'dev-outbox' };
}

module.exports = {
  sendPasswordResetOtp,
  sendGeneric,
  getLastDevEmail,
  clearDevOutbox,
  peekLastOtp,
};
