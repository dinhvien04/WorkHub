"use strict";

const amqp = require("amqplib");
const { trace, propagation, context, ROOT_CONTEXT, SpanKind } = require("@opentelemetry/api");
const { validateEvent } = require("@workhub/contracts");

/**
 * Connect to RabbitMQ with reconnect retry logic.
 */
async function connect(url, retries = 5, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[Messaging] Connecting to RabbitMQ at ${url} (Attempt ${i + 1}/${retries})...`);
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
 */
async function subscribeEvent(channel, { queueName, exchangeName = "workhub.events", routingKeyPattern, prefetchCount = 10, handler, onDeadLetter }) {
  // Bounded prefetch
  await channel.prefetch(prefetchCount);

  const dlqName = `${queueName}.dlq`;
  const retryQueueName = `${queueName}.retry`;

  // 1. Declare Dead-Letter Queue (DLQ) and bind to DLX
  await channel.assertQueue(dlqName, { durable: true });
  await channel.bindQueue(dlqName, "workhub.events.dlx", dlqName);

  // 2. Declare Retry Delayed Queue (routes back to main queue via primary exchange)
  await channel.assertQueue(retryQueueName, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": exchangeName,
      "x-dead-letter-routing-key": queueName,
      "x-message-ttl": 5000 // 5-second backoff delay
    }
  });
  await channel.bindQueue(retryQueueName, "workhub.events.retry", retryQueueName);

  // 3. Declare Main Queue binding to DLX for unhandled rejects
  await channel.assertQueue(queueName, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "workhub.events.dlx",
      "x-dead-letter-routing-key": dlqName
    }
  });
  await channel.bindQueue(queueName, exchangeName, routingKeyPattern);

  // 4. Start consuming
  return channel.consume(queueName, async (msg) => {
    if (!msg) return; // Consumer cancelled by broker

    const parentContext = propagation.extract(ROOT_CONTEXT, msg.properties.headers || {});
    const tracer = trace.getTracer("workhub-messaging");
    const spanName = `consume ${msg.fields.routingKey}`;

    await tracer.startActiveSpan(spanName, { kind: SpanKind.CONSUMER }, parentContext, async (span) => {
      try {
        span.setAttribute("messaging.system", "rabbitmq");
        span.setAttribute("messaging.destination", exchangeName);
        span.setAttribute("messaging.routing_key", msg.fields.routingKey);
        span.setAttribute("messaging.message_id", msg.properties.messageId || "unknown");

        const rawContent = msg.content.toString();
        let event;
        try {
          event = JSON.parse(rawContent);
        } catch (jsonErr) {
          console.error("[Messaging] Failed to parse message body as JSON:", rawContent);
          // Directly DLQ formatting issues
          channel.reject(msg, false);
          return;
        }

        // Schema validation check upon receipt
        try {
          validateEvent(event);
        } catch (validationErr) {
          console.error("[Messaging] Event failed schema validation:", validationErr.message, event);

          if (onDeadLetter) {
            await onDeadLetter(msg, event, `Schema Validation Failed: ${validationErr.message}`);
          }

          // Route immediately to DLQ (no retry)
          channel.reject(msg, false);
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

        // Handle retry queue backoff
        const headers = msg.properties.headers || {};
        const retryCount = Number(headers["x-retry-count"]) || 0;
        const maxRetries = 3;

        if (retryCount < maxRetries) {
          try {
            console.log(`[Messaging] Re-enqueuing message to retry queue (Retry ${retryCount + 1}/${maxRetries})...`);

            // Publish message to retry queue
            const retryHeaders = {
              ...headers,
              "x-retry-count": retryCount + 1,
              "x-original-error": err.message
            };

            channel.publish("workhub.events.retry", retryQueueName, msg.content, {
              persistent: true,
              messageId: msg.properties.messageId,
              timestamp: msg.properties.timestamp,
              headers: retryHeaders
            });

            // Ack original message so it doesn't get reprocessed immediately
            channel.ack(msg);
          } catch (pubErr) {
            console.error("[Messaging] Failed to publish message to retry queue:", pubErr.message);
            // Requeue as fallback
            channel.nack(msg, false, true);
          }
        } else {
          try {
            console.warn(`[Messaging] Message exceeded max retries (${maxRetries}). Directing to DLQ.`);

            if (onDeadLetter) {
              const event = JSON.parse(msg.content.toString());
              await onDeadLetter(msg, event, `Max Retries Exceeded: ${err.message}`);
            }
          } catch (deadLetterErr) {
            console.error("[Messaging] Error saving to dead letter database:", deadLetterErr.message);
          }

          // Reject without requeue (routes to DLQ via arguments)
          channel.reject(msg, false);
        }
      }
    });
  }, { noAck: false }); // Enable manual acknowledgments
}

module.exports = {
  connect,
  createConfirmChannel,
  publishEvent,
  subscribeEvent,
};
