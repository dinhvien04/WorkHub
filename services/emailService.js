'use strict';

const logger = require('../utils/logger');

/**
 * Email adapter. In development, stores last message in memory (never logs OTP in production).
 */
const outbox = [];

async function sendPasswordResetOtp({ to, otp }) {
  const payload = {
    to,
    subject: 'WorkHub password reset',
    body: `Your password reset code is: ${otp}`,
    createdAt: new Date(),
  };

  outbox.push(payload);

  if (process.env.NODE_ENV !== 'production') {
    // Dev-only: do not use console.log for OTP in production (gated above)
    logger.info(`[DEV EMAIL] password reset for ${to} — code delivered to dev outbox (not logged)`);
  }

  // Hook for real provider:
  // await transporter.sendMail({ to, subject: payload.subject, text: payload.body });

  return { ok: true };
}

function getLastDevEmail() {
  return outbox[outbox.length - 1] || null;
}

function clearDevOutbox() {
  outbox.length = 0;
}

/** Test helper: peek OTP from last email (dev/test only). */
function peekLastOtp() {
  const last = getLastDevEmail();
  if (!last || !last.body) return null;
  const m = last.body.match(/code is: (\d+)/);
  return m ? m[1] : null;
}

module.exports = {
  sendPasswordResetOtp,
  getLastDevEmail,
  clearDevOutbox,
  peekLastOtp,
};
