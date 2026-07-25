"use strict";

const CommunicationOutbox = require("../models/CommunicationOutbox");
const emailTemplates = require("../templates/emailTemplates");
const env = require("../config/env");
const crypto = require("crypto");

const devOutbox = [];

async function enqueueTemplate({ template, recipientId, toEmail, data }, options = {}) {
  const session = options.session;
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(data || {})).digest("hex").slice(0, 16);
  const idempotencyKey = options.idempotencyKey || `email:${template}:${recipientId}:${payloadHash}`;

  const [doc] = await CommunicationOutbox.create(
    [
      {
        Type: "email",
        RecipientID: recipientId,
        Payload: {
          template,
          to: toEmail,
          data,
        },
        Status: "pending",
        IdempotencyKey: idempotencyKey,
        AvailableAt: new Date(),
      },
    ],
    { session }
  );

  return doc;
}

async function dispatchEmail(outboxItem) {
  const { template, to, data } = outboxItem.Payload;
  const rendered = emailTemplates.render(template, data);

  const recipientEmail = to || data.toEmail;

  if (env.SHADOW_MODE) {
    console.log(`[EmailService] [SHADOW MODE] Skipping Resend API call to ${recipientEmail} for template ${template}`);
    // Reconciliation logging comparison details
    const contentHash = crypto.createHash("sha256").update(rendered.html).digest("hex");
    console.log({
      message: "Shadow Mode: Email prepared but bypassed",
      idempotencyKey: outboxItem.IdempotencyKey,
      to: recipientEmail,
      subject: rendered.subject,
      contentHash,
      bypassed: true,
    });
    return { ok: true, bypassed: true, hash: contentHash };
  }

  if (env.isProduction) {
    if (!env.RESEND_API_KEY) {
      throw new Error("Missing RESEND_API_KEY environment variable in production email dispatch.");
    }

    // Call Resend API via native fetch (HTTP POST)
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: recipientEmail,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Resend API returned status ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    return { ok: true, messageId: result.id };
  } else {
    // Development mode
    const payload = {
      from: env.EMAIL_FROM,
      to: recipientEmail,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      sentAt: new Date().toISOString(),
    };
    devOutbox.push(payload);
    console.log(`[DEV EMAIL] queued for ${recipientEmail}: subject="${rendered.subject}"`);
    return { ok: true, mode: "dev-outbox" };
  }
}

// Dev helpers
function getDevOutbox() {
  return devOutbox;
}

function clearDevOutbox() {
  devOutbox.length = 0;
}

module.exports = {
  enqueueTemplate,
  dispatchEmail,
  getDevOutbox,
  clearDevOutbox,
};
