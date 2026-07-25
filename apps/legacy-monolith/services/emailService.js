"use strict";

const logger = require("../utils/logger");
const env = require("../config/env");
const emailTemplates = require("./emailTemplates");

const outbox = [];

function publicBaseUrl() {
  return (
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

async function sendViaResend({ to, subject, text, html }) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const body = {
    from: env.EMAIL_FROM,
    to: [to],
    subject,
    text,
  };
  if (html) body.html = html;

  const res = await globalThis.fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend failed: ${res.status} ${errBody}`);
  }
  return { ok: true, provider: "resend" };
}

async function dispatch({ to, subject, text, html }) {
  const payload = {
    to,
    subject: subject || "WorkHub",
    body: text || "",
    html: html || "",
    createdAt: new Date(),
  };

  if (env.isProduction) {
    if (!env.EMAIL_PROVIDER || !env.EMAIL_FROM) {
      throw new Error(
        "Email provider is not configured for production (EMAIL_PROVIDER, EMAIL_FROM).",
      );
    }
    if (env.EMAIL_PROVIDER === "resend") {
      await sendViaResend({
        to,
        subject: payload.subject,
        text: payload.body,
        html: payload.html || undefined,
      });
      logger.info(`Email dispatched to ${to}: ${payload.subject}`);
      return { ok: true, provider: "resend" };
    }
    throw new Error(`Unsupported EMAIL_PROVIDER: ${env.EMAIL_PROVIDER}`);
  }

  outbox.push(payload);
  logger.info(`[DEV EMAIL] queued for ${to}: ${payload.subject}`);
  return { ok: true, provider: "dev-outbox" };
}

/**
 * Render template + send. Never throws to callers via safeSend helpers.
 */
async function sendTemplate(templateName, { to, ...data }) {
  if (!to) throw new Error("Missing email recipient");
  const rendered = emailTemplates.render(templateName, {
    ...data,
    baseUrl: data.baseUrl || publicBaseUrl(),
  });
  return dispatch({
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}

/** Fire-and-forget; logs errors, does not throw */
function safeSendTemplate(templateName, opts) {
  return sendTemplate(templateName, opts).catch((err) => {
    logger.warn(`Email template ${templateName} failed: ${err.message}`);
    return { ok: false, error: err.message };
  });
}

async function sendPasswordResetOtp({ to, otp }) {
  return sendTemplate("password_reset", { to, otp });
}

async function sendGeneric({ to, subject, text, html }) {
  if (html) {
    return dispatch({ to, subject, text, html });
  }
  // Prefer generic template for HTML wrapper
  const rendered = emailTemplates.render("generic", {
    subject,
    title: subject,
    body: text,
  });
  return dispatch({
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
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
  const m = last.body.match(/(?:code is:|OTP của bạn:|là:)\s*(\d+)/i);
  if (m) return m[1];
  const m2 = last.body.match(/(\d{6})/);
  return m2 ? m2[1] : null;
}

function listDevOutbox() {
  return outbox.slice();
}

module.exports = {
  sendPasswordResetOtp,
  sendGeneric,
  sendTemplate,
  safeSendTemplate,
  getLastDevEmail,
  clearDevOutbox,
  peekLastOtp,
  listDevOutbox,
  publicBaseUrl,
};
