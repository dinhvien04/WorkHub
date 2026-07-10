'use strict';

const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

/**
 * Record request duration; set Server-Timing header (no PII).
 */
function requestTiming(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ns = Number(process.hrtime.bigint() - start);
    const ms = Math.round(ns / 1e6);
    try {
      metrics.observeHttpRequest({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: ms,
      });
    } catch {
      /* ignore */
    }
    if (ms >= 800 || res.statusCode >= 500) {
      logger.warn(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms,
          requestId: req.requestId,
          traceId: req.trace?.traceId,
        },
        'slow_or_error_request'
      );
    }
  });
  const origEnd = res.end;
  res.end = function endWithTiming(...args) {
    const ns = Number(process.hrtime.bigint() - start);
    const ms = Math.round(ns / 1e6);
    if (!res.headersSent) {
      res.setHeader('Server-Timing', `app;dur=${ms}`);
      res.setHeader('X-Response-Time', `${ms}ms`);
    }
    return origEnd.apply(this, args);
  };
  next();
}

module.exports = requestTiming;
