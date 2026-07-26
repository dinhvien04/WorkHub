"use strict";

const amqp = require("amqplib");
const { trace, propagation, context, ROOT_CONTEXT, SpanKind } = require("@opentelemetry/api");
const { validateEvent } = require("@workhub/contracts");

function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "xxxxxx";
    return parsed.toString();
  } catch {
    return url.replace(/:([^@:]+)@/, ':xxxxxx@');
  }
}

/**
 * Connect to RabbitMQ with reconnect retry logic.
 */
async function connect(url, retries = 5, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[Messaging] Connecting to RabbitMQ at ${sanitizeUrl(url)} (Attempt ${i + 1}/${retries})...`);
      const conn = await amqp.connect(url);
      console.log("[Messaging] Connected to RabbitMQ successfully.");

      conn.on("error", (err) => {
        console.error("[Messaging] Connection error:", err.message);
      });

      conn.on("close", () => {
        console.warn("[Messaging] Connection closed.");
      });

      return conn;
    } catch (err) {
      console.error(`[Messaging] Connection failed: ${err.message}`);
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Create a confirm channel and declare exchanges/topologies.
 */
async function createConfirmChannel(connection) {
  const channel = await connection.createConfirmChannel();

  // 1. Declare Main Exchange (topic)
  await channel.assertExchange("workhub.events", "topic", { durable: true });

  // 2. Declare Dead-Letter Exchange (topic)
  await channel.assertExchange("workhub.events.dlx", "topic", { durable: true });

  // 3. Declare Retry Exchange (topic)
  await channel.assertExchange("workhub.events.retry", "topic", { durable: true });

  return channel;
}

/**
 * Publish an integration event to the broker with confirms and telemetry propagation.
 */
async function publishEvent(channel, event) {
  // Validate schema event contract before sending
  validateEvent(event);

  const exchangeName = "workhub.events";
  const routingKey = event.eventType;

  // Inject OpenTelemetry Context Propagation
  const headers = {};
  propagation.inject(context.active(), headers);

  // Add retry-count default header
  headers["x-retry-count"] = 0;

  const tracer = trace.getTracer("workhub-messaging");
  const spanName = `publish ${routingKey}`;

  return tracer.startActiveSpan(spanName, { kind: SpanKind.PRODUCER }, async (span) => {
    try {
      span.setAttribute("messaging.system", "rabbitmq");
      span.setAttribute("messaging.destination", exchangeName);
      span.setAttribute("messaging.routing_key", routingKey);
      span.setAttribute("messaging.message_id", event.eventId);

      const messageBuffer = Buffer.from(JSON.stringify(event));

      const publishPromise = new Promise((resolve, reject) => {
        channel.publish(
          exchangeName,
          routingKey,
          messageBuffer,
          {
            persistent: true,
            messageId: event.eventId,
            timestamp: new Date(event.occurredAt).getTime(),
            headers: headers,
          },
          (err, ok) => {
            if (err) reject(err);
            else resolve(ok);
          }
        );
      });

      await publishPromise;
      span.setStatus({ code: 1 }); // OK
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: 2, message: err.message }); // ERROR
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Configure topology for a service queue, binds routing key, and subscribes.
 * Relies on RabbitMQ policies for DLX/TTL backoffs to support dynamic configurability.
 */
async function subscribeEvent(channel, { queueName, exchangeName = "workhub.events", routingKeyPattern, prefetchCount = 10, handler, onDeadLetter }) {
  // Bounded prefetch
  await channel.prefetch(prefetchCount);

  const dlqName = `${queueName}.dlq`;
  const retryQueueName = `${queueName}.retry`;

  // 1. Declare Dead-Letter Queue (DLQ) and bind to DLX
  await channel.assertQueue(dlqName, { durable: true });
  await channel.bindQueue(dlqName, "workhub.events.dlx", dlqName);

  // 2. Declare Retry Delayed Queue
  await channel.assertQueue(retryQueueName, { durable: true });
  await channel.bindQueue(retryQueueName, "workhub.events.retry", retryQueueName);

  // 3. Declare Main Queue
  await channel.assertQueue(queueName, { durable: true });
  await channel.bindQueue(queueName, exchangeName, routingKeyPattern);

  // 4. Start consuming
  return channel.consume(queueName, async (msg) => {
    if (!msg) return; // Consumer cancelled by broker

    const parentContext = propagation.extract(ROOT_CONTEXT, msg.properties.headers || {});
    const tracer = trace.getTracer("workhub-messaging");
    const spanName = `consume ${msg.fields.routingKey}`;

    await tracer.startActiveSpan(spanName, { kind: SpanKind.CONSUMER }, parentContext, async (span) => {
      let event;
      try {
        span.setAttribute("messaging.system", "rabbitmq");
        span.setAttribute("messaging.destination", exchangeName);
        span.setAttribute("messaging.routing_key", msg.fields.routingKey);
        span.setAttribute("messaging.message_id", msg.properties.messageId || "unknown");

        const rawContent = msg.content.toString();
        try {
          event = JSON.parse(rawContent);
        } catch (jsonErr) {
          console.error("[Messaging] Failed to parse message body as JSON:", rawContent);
          // Directly DLQ formatting issues
          await publishToDlq(channel, dlqName, msg);
          return;
        }

        // Schema validation check upon receipt
        try {
          validateEvent(event);
        } catch (validationErr) {
          // Log identifiers, not the envelope — a failed verify-email event
          // carries a live token, and log aggregation keeps it far longer
          // than the token's own TTL.
          console.error(
            `[Messaging] Event failed schema validation (eventId=${event && event.eventId}, ` +
              `type=${event && event.eventType}): ${validationErr.message}`,
          );

          if (onDeadLetter) {
            await onDeadLetter(msg, event, `Schema Validation Failed: ${validationErr.message}`);
          }

          // Route immediately to DLQ
          await publishToDlq(channel, dlqName, msg);
          span.recordException(validationErr);
          span.setStatus({ code: 2, message: validationErr.message });
          return;
        }

        // Execute processing logic
        await handler(event, msg);

        // Success - manual acknowledgement
        channel.ack(msg);
        span.setStatus({ code: 1 }); // OK
      } catch (err) {
        console.error(`[Messaging] Error handling message ${msg.properties.messageId}: ${err.message}`);
        span.recordException(err);
        span.setStatus({ code: 2, message: err.message });

        // Retrieve retry count using AMQP x-death headers populated by DLX routing
        const headers = msg.properties.headers || {};
        const xDeath = headers["x-death"] || [];
        const deathEntry = xDeath.find((d) => d.queue === queueName);
        const retryCount = deathEntry ? deathEntry.count : 0;
        const maxRetries = 3;

        if (retryCount < maxRetries) {
          // Reject message with requeue = false, triggering DLX policy to route it to retry queue
          channel.reject(msg, false);
        } else {
          try {
            console.warn(`[Messaging] Message exceeded max retries (${maxRetries}). Directing to DLQ.`);

            if (onDeadLetter) {
              await onDeadLetter(msg, event, `Max Retries Exceeded: ${err.message}`);
            }
          } catch (deadLetterErr) {
            console.error("[Messaging] Error saving to dead letter database:", deadLetterErr.message);
          }

          // Terminal failure: Publish manually to DLQ and ACK to clear it from main queue
          await publishToDlq(channel, dlqName, msg);
        }
      }
    });
  }, { noAck: false }); // Enable manual acknowledgments
}

/**
 * Helper to manually publish messages to DLQ exchange and acknowledge them.
 */
async function publishToDlq(channel, dlqName, msg) {
  try {
    await new Promise((resolve, reject) => {
      channel.publish(
        "workhub.events.dlx",
        dlqName,
        msg.content,
        {
          persistent: true,
          messageId: msg.properties.messageId,
          headers: msg.properties.headers,
        },
        (err, ok) => {
          if (err) reject(err);
          else resolve(ok);
        }
      );
    });
    // Remove original from main queue
    channel.ack(msg);
  } catch (err) {
    console.error("[Messaging] Failed to route to DLQ:", err.message);
    // Nack and requeue as fallback
    channel.nack(msg, false, true);
  }
}

module.exports = {
  connect,
  createConfirmChannel,
  publishEvent,
  subscribeEvent,
};
