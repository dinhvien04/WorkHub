"use strict";

/**
 * Upload content safety checks (no external AV required).
 * - Magic bytes
 * - Size / empty
 * - Reject polyglot / script-looking PDFs loosely
 * Optional: CLAMAV_HOST for future TCP clamd integration (not required).
 */
const { sniffImageOrPdf, assertAllowedMagic } = require("../utils/magicBytes");
const { ValidationError } = require("../utils/errors");

const MAX_BYTES = 5 * 1024 * 1024;

function scanBuffer(buffer, { allowPdf = false, fieldname = "file" } = {}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { ok: true, skipped: true, reason: "no_buffer" };
  }
  if (buffer.length === 0) {
    throw new ValidationError(`File ${fieldname} rỗng.`);
  }
  if (buffer.length > MAX_BYTES) {
    throw new ValidationError(`File ${fieldname} vượt quá 5MB.`);
  }
  const kind = assertAllowedMagic(buffer, { allowPdf });
  // Cheap polyglot heuristic: HTML/JS in "image"
  if (kind.startsWith("image/")) {
    const head = buffer.slice(0, 512).toString("utf8").toLowerCase();
    if (head.includes("<script") || head.includes("<html")) {
      throw new ValidationError("File ảnh chứa nội dung script không hợp lệ.");
    }
  }
  return { ok: true, mime: kind, bytes: buffer.length };
}

/**
 * Middleware after multer memory storage (async for optional ClamAV).
 */
function scanUploadedFiles({ allowPdfFields = ["verificationDocument"] } = {}) {
  return async (req, res, next) => {
    try {
      const files = [];
      if (req.file) files.push(req.file);
      if (Array.isArray(req.files)) files.push(...req.files);
      else if (req.files && typeof req.files === "object") {
        Object.values(req.files).forEach((arr) => {
          if (Array.isArray(arr)) files.push(...arr);
        });
      }
      const clamav = require("./clamavService");
      for (const f of files) {
        if (!f.buffer) continue;
        const allowPdf = allowPdfFields.includes(f.fieldname);
        const result = scanBuffer(f.buffer, {
          allowPdf,
          fieldname: f.fieldname,
        });
        f.detectedMime = result.mime;
        await clamav.scanBufferOptional(f.buffer);
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { scanBuffer, scanUploadedFiles, sniffImageOrPdf };
