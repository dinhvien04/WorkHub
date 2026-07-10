'use strict';

const logger = require('../utils/logger');

/**
 * Record request duration; set Server-Timing header (no PII).
 */
function requestTiming(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ns = Number(process.hrtime.bigint() - start);
    const ms = Math.round(ns / 1e6);
    try {
      res.setHeader('Server-Timing', `app;dur=${ms}`);
    } catch {
      /* headers may be sent */
    }
    if (ms >= 800 || res.statusCode >= 500) {
      logger.warn(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms,
          requestId: req.requestId,
        },
        'slow_or_error_request'
      );
    }
  });
  // Also try set header before finish via interceptor
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
