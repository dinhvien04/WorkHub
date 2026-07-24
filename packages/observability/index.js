"use strict";

const { trace } = require("@opentelemetry/api");

/**
 * Get tracer instance for the service.
 */
function getTracer(serviceName) {
  return trace.getTracer(serviceName || "workhub-observability");
}

/**
 * Format log message to inject standard structured context fields.
 */
function formatStructuredLog({ service, version, env, reqId, traceId, spanId, correlationId, err }) {
  return {
    timestamp: new Date().toISOString(),
    service: service || "unknown-service",
    version: version || "1.1.0",
    environment: env || process.env.NODE_ENV || "development",
    requestId: reqId || null,
    traceId: traceId || null,
    spanId: spanId || null,
    correlationId: correlationId || null,
    errorCode: err ? err.code || err.name : null,
    errorMessage: err ? err.message : null,
  };
}

module.exports = {
  getTracer,
  formatStructuredLog,
};
