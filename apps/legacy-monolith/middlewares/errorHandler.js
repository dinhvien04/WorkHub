"use strict";

const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");

function notFoundHandler(req, res, _next) {
  if (req.path.startsWith("/api/")) {
    return res
      .status(404)
      .json({ error: "API endpoint không tồn tại.", code: "NOT_FOUND" });
  }
  return res.status(404).send("Trang không tồn tại.");
}

function errorHandler(err, req, res, _next) {
  // Multer / payload errors. The non-file limits (field count, field size,
  // part count) must be listed too, otherwise tripping one of them falls
  // through to the generic 500 handler and reads as a server fault rather than
  // a rejected request.
  const MULTER_LIMIT_CODES = new Set([
    "LIMIT_FILE_SIZE",
    "LIMIT_FILE_COUNT",
    "LIMIT_UNEXPECTED_FILE",
    "LIMIT_FIELD_COUNT",
    "LIMIT_FIELD_KEY",
    "LIMIT_FIELD_VALUE",
    "LIMIT_PART_COUNT",
  ]);
  if (err && MULTER_LIMIT_CODES.has(err.code)) {
    return res.status(400).json({
      error: err.message || "File upload không hợp lệ.",
      code: err.code,
    });
  }

  if (err && err.type === "entity.too.large") {
    return res
      .status(413)
      .json({ error: "Payload quá lớn.", code: "PAYLOAD_TOO_LARGE" });
  }

  // Mongoose cast / validation
  if (err && err.name === "CastError") {
    return res
      .status(400)
      .json({ error: "ID không hợp lệ.", code: "INVALID_ID" });
  }
  if (err && err.name === "ValidationError") {
    return res
      .status(400)
      .json({ error: err.message, code: "MONGOOSE_VALIDATION" });
  }
  if (err && err.code === 11000) {
    return res
      .status(409)
      .json({ error: "Dữ liệu bị trùng lặp.", code: "DUPLICATE_KEY" });
  }

  const status = err.statusCode || err.status || 500;
  const isOperational = err instanceof AppError || err.isOperational;

  if (!isOperational || status >= 500) {
    logger.error("Unhandled error", {
      requestId: req.requestId,
      message: err.message,
      stack: err.stack,
    });
  }

  const body = {
    error:
      isOperational || process.env.NODE_ENV !== "production"
        ? err.message || "Đã xảy ra lỗi server"
        : "Đã xảy ra lỗi server",
    code: err.code || "INTERNAL_ERROR",
  };

  if (err.details) body.details = err.details;
  if (req.requestId) body.requestId = req.requestId;

  if (process.env.NODE_ENV !== "production" && !isOperational) {
    body.stack = err.stack;
  }

  res.status(status).json(body);
}

module.exports = { notFoundHandler, errorHandler };
