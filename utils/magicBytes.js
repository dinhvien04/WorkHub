'use strict';

/**
 * Validate file buffers by magic bytes (not client-reported MIME alone).
 */
function sniffImageOrPdf(buffer) {
  if (!buffer || buffer.length < 4) return null;
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  // PDF
  if (buffer.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  return null;
}

function assertAllowedMagic(buffer, { allowPdf = false } = {}) {
  const kind = sniffImageOrPdf(buffer);
  if (!kind) {
    const err = new Error('Nội dung file không hợp lệ (magic bytes).');
    err.statusCode = 400;
    err.isOperational = true;
    throw err;
  }
  if (kind === 'application/pdf' && !allowPdf) {
    const err = new Error('Không chấp nhận PDF cho field này.');
    err.statusCode = 400;
    err.isOperational = true;
    throw err;
  }
  return kind;
}

/**
 * Express middleware: after multer, inspect req.file / req.files buffers.
 * Works with memoryStorage; with disk/Cloudinary may only have path — skip if no buffer.
 */
function validateUploadMagicBytes({ allowPdfFields = ['verificationDocument'] } = {}) {
  return (req, res, next) => {
    try {
      const files = [];
      if (req.file) files.push(req.file);
      if (Array.isArray(req.files)) files.push(...req.files);
      else if (req.files && typeof req.files === 'object') {
        Object.values(req.files).forEach((arr) => {
          if (Array.isArray(arr)) files.push(...arr);
        });
      }
      for (const f of files) {
        if (!f.buffer || !f.buffer.length) continue;
        const allowPdf = allowPdfFields.includes(f.fieldname);
        assertAllowedMagic(f.buffer, { allowPdf });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  sniffImageOrPdf,
  assertAllowedMagic,
  validateUploadMagicBytes,
};
