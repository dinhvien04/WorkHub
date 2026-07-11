"use strict";

/**
 * Lightweight W3C trace context + optional OTLP/HTTP JSON export.
 * No OpenTelemetry SDK dependency.
 *
 * Env:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *   OTEL_SERVICE_NAME=workhub
 *   OTEL_TRACES_SAMPLER=1.0   (0..1)
 */
const crypto = require("crypto");
const logger = require("./logger");

const serviceName = process.env.OTEL_SERVICE_NAME || "workhub";
const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").replace(
  /\/$/,
  "",
);
const sampleRate = Math.min(
  1,
  Math.max(0, Number(process.env.OTEL_TRACES_SAMPLER ?? "1")),
);

const buffer = [];
const MAX_BUFFER = 100;
let flushTimer = null;

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function parseTraceparent(header) {
  // version-traceid-spanid-flags
  if (!header || typeof header !== "string") return null;
  const parts = header.trim().split("-");
  if (parts.length < 4) return null;
  const [ver, traceId, parentId, flags] = parts;
  if (traceId.length !== 32 || parentId.length !== 16) return null;
  return { ver, traceId, parentId, flags };
}

function shouldSample() {
  return Math.random() < sampleRate;
}

function startSpan(req) {
  const incoming = parseTraceparent(req.headers.traceparent);
  const sampled = shouldSample();
  const traceId = incoming?.traceId || randomHex(16);
  const spanId = randomHex(8);
  const parentSpanId = incoming?.parentId || undefined;
  const start = process.hrtime.bigint();
  return {
    traceId,
    spanId,
    parentSpanId,
    sampled,
    name: `${req.method} ${req.path}`,
    start,
    attributes: {
      "http.method": req.method,
      "http.route": req.path,
      "http.target": req.originalUrl?.slice(0, 200),
      "service.name": serviceName,
    },
  };
}

function endSpan(span, res) {
  if (!span || !span.sampled) return;
  const end = process.hrtime.bigint();
  const durationNs = Number(end - span.start);
  span.attributes["http.status_code"] = res.statusCode;
  span.attributes["http.response_time_ms"] = Math.round(durationNs / 1e6);
  buffer.push({
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    startTimeUnixNano: String(Date.now() * 1e6 - durationNs),
    endTimeUnixNano: String(Date.now() * 1e6),
    attributes: span.attributes,
  });
  if (buffer.length >= 20) flush().catch(() => {});
  else scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer || !endpoint) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch(() => {});
  }, 5000);
  if (flushTimer.unref) flushTimer.unref();
}

async function flush() {
  if (!endpoint || !buffer.length) {
    buffer.length = 0;
    return;
  }
  const batch = buffer.splice(0, MAX_BUFFER);
  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "workhub-lite-tracer", version: "1.0.0" },
            spans: batch.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId,
              name: s.name,
              kind: 2, // SERVER
              startTimeUnixNano: s.startTimeUnixNano,
              endTimeUnixNano: s.endTimeUnixNano,
              attributes: Object.entries(s.attributes).map(([key, val]) => ({
                key,
                value:
                  typeof val === "number"
                    ? { intValue: String(Math.round(val)) }
                    : { stringValue: String(val) },
              })),
            })),
          },
        ],
      },
    ],
  };
  try {
    const url = endpoint.endsWith("/v1/traces")
      ? endpoint
      : `${endpoint}/v1/traces`;
    const res = await globalThis.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn(`OTLP export failed: ${res.status}`);
    }
  } catch (err) {
    logger.warn(`OTLP export error: ${err.message}`);
  }
}

function tracingMiddleware(req, res, next) {
  const span = startSpan(req);
  req.trace = span;
  if (span.sampled) {
    const flags = "01";
    res.setHeader("traceparent", `00-${span.traceId}-${span.spanId}-${flags}`);
  }
  res.on("finish", () => endSpan(span, res));
  next();
}

module.exports = {
  tracingMiddleware,
  flush,
  parseTraceparent,
  startSpan,
  endSpan,
};
