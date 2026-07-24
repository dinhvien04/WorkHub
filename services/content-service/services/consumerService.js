"use strict";

const { messaging } = require("@workhub/observability");
const env = require("../config/env");

let connection = null;
let channel = null;

function isConnected() {
  return connection && connection.connection ? true : false;
}

async function start() {
  try {
    connection = await messaging.connect(env.RABBITMQ_URL);
    channel = await messaging.createConfirmChannel(connection);
    console.log("[ConsumerService] Connected to RabbitMQ for Content Service.");
  } catch (err) {
    console.error("[ConsumerService] Failed to connect to RabbitMQ:", err.message);
    // In test environment, don't crash bootstrap if RabbitMQ is offline
    if (env.isTest) return;
    throw err;
  }
}

async function stop() {
  if (channel) await channel.close().catch(() => {});
  if (connection) await connection.close().catch(() => {});
}

function getChannel() {
  return channel;
}

module.exports = {
  start,
  stop,
  isConnected,
  getChannel,
};
