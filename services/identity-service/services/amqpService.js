"use strict";

/**
 * RabbitMQ connection lifecycle for identity-service.
 *
 * The outbox publisher is the only writer, so a single confirm channel is
 * enough. A dropped connection is not an error the request path ever sees —
 * events stay in the outbox and the publisher retries once the broker is back.
 */
const { messaging } = require("@workhub/observability");
const env = require("../config/env");

let connection = null;
let channel = null;
let connecting = null;
let closed = false;

function isConnected() {
  return Boolean(connection && channel && !closed);
}

function getChannel() {
  return closed ? null : channel;
}

async function connect() {
  if (env.DISABLE_MQ) return null;
  if (channel && !closed) return channel;
  if (connecting) return connecting;

  connecting = (async () => {
    connection = await messaging.connect(env.RABBITMQ_URL);
    channel = await messaging.createConfirmChannel(connection);
    closed = false;

    connection.on("close", () => {
      channel = null;
      connection = null;
      connecting = null;
    });
    connection.on("error", (err) => {
      console.error("[IdentityAmqp] Connection error:", err.message);
    });

    console.log("[IdentityAmqp] Confirm channel ready.");
    return channel;
  })();

  try {
    return await connecting;
  } catch (err) {
    connecting = null;
    channel = null;
    connection = null;
    throw err;
  } finally {
    connecting = null;
  }
}

/**
 * Best-effort connect used by the publisher loop — a broker outage must not
 * crash the service, only pause publishing.
 */
async function ensureChannel() {
  if (env.DISABLE_MQ) return null;
  if (channel && !closed) return channel;
  try {
    return await connect();
  } catch (err) {
    console.error("[IdentityAmqp] Broker unavailable:", err.message);
    return null;
  }
}

async function close() {
  closed = true;
  if (channel) {
    await channel.close().catch(() => {});
    channel = null;
  }
  if (connection) {
    await connection.close().catch(() => {});
    connection = null;
  }
}

module.exports = { connect, ensureChannel, getChannel, isConnected, close };
