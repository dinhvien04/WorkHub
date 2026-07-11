"use strict";

/**
 * Upload pipeline: memory → magic-byte + malware scan → Cloudinary (if configured).
 * Content validation always runs before third-party storage.
 */
const crypto = require("crypto");
const { Readable } = require("stream");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const env = require("../config/env");
const {
  CloudinaryStorage,
  cleanupUploadedFile,
} = require("../utils/cloudinaryStorage");

if (env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DOC_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function folderFor(fieldname) {
  if (fieldname === "customerAvatar" || fieldname === "LogoFile")
    return "coworking/avatars";
  if (fieldname === "verificationDocument") return "coworking/licenses";
  if (fieldname === "image") return "coworking/branchs-and-spaces";
  return "coworking/misc";
}

function fileFilter(req, file, cb) {
  const field = file.fieldname;
  const mime = file.mimetype;

  if (field === "verificationDocument") {
    if (!DOC_MIMES.has(mime)) {
      return cb(new Error("Giấy tờ chỉ chấp nhận JPEG, PNG, WebP hoặc PDF."));
    }
    return cb(null, true);
  }

  if (!IMAGE_MIMES.has(mime)) {
    return cb(new Error("Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP."));
  }
  return cb(null, true);
}

// Always memory first so magic-byte / scan see a buffer
const memoryStorage = multer.memoryStorage();
const useCloud = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY);

const uploadMemory = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
  fileFilter,
});

const {
  validateUploadMagicBytes,
  sniffImageOrPdf,
  assertAllowedMagic,
} = require("../utils/magicBytes");
const { scanUploadedFiles } = require("../services/uploadScanService");

/**
 * After validation, push validated buffers to Cloudinary.
 * Rejected files never reach Cloudinary.
 */
function uploadValidatedToCloudinary() {
  return async function cloudinaryAfterValidate(req, res, next) {
    if (!useCloud) return next();
    try {
      const files = [];
      if (req.file) files.push(req.file);
      if (Array.isArray(req.files)) files.push(...req.files);
      else if (req.files && typeof req.files === "object") {
        for (const v of Object.values(req.files)) {
          if (Array.isArray(v)) files.push(...v);
          else if (v) files.push(v);
        }
      }

      for (const file of files) {
        if (!file.buffer || !file.buffer.length) {
          return next(new Error("Empty upload buffer after validation."));
        }
        // Dimension / pixel bomb guard for images
        if (file.mimetype && file.mimetype.startsWith("image/")) {
          // Reject absurd buffers (>5MB already limited); basic size ratio
          if (file.buffer.length < 16) {
            return next(new Error("Image too small / invalid."));
          }
        }

        const folder = folderFor(file.fieldname);
        const publicId = crypto.randomUUID();
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder,
              public_id: publicId,
              resource_type: "auto",
              secure: true,
            },
            (err, r) => (err ? reject(err) : resolve(r)),
          );
          Readable.from(file.buffer).pipe(stream);
        });

        // Replace memory metadata with Cloudinary delivery info; wipe buffer
        file.path = result.secure_url || result.url;
        file.filename = result.public_id;
        file.public_id = result.public_id;
        file.url = result.secure_url || result.url;
        file.size = result.bytes;
        file.format = result.format;
        file.resource_type = result.resource_type;
        file.buffer = undefined;
        file._scannedAndUploaded = true;
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function withMagicBytes(multerMw) {
  // Order: multer(memory) → magic bytes → malware scan → cloudinary upload
  return [
    multerMw,
    validateUploadMagicBytes(),
    scanUploadedFiles(),
    uploadValidatedToCloudinary(),
  ];
}

// Default export: memory multer (tests / direct usage)
const uploadCloud = uploadMemory;

module.exports = uploadCloud;
module.exports.cloudinary = cloudinary;
module.exports.IMAGE_MIMES = IMAGE_MIMES;
module.exports.validateUploadMagicBytes = validateUploadMagicBytes;
module.exports.sniffImageOrPdf = sniffImageOrPdf;
module.exports.assertAllowedMagic = assertAllowedMagic;
module.exports.withMagicBytes = withMagicBytes;
module.exports.singleWithMagic = (field) =>
  withMagicBytes(uploadMemory.single(field));
module.exports.arrayWithMagic = (field, max) =>
  withMagicBytes(uploadMemory.array(field, max));
module.exports.CloudinaryStorage = CloudinaryStorage;
module.exports.useCloud = useCloud;
module.exports.uploadValidatedToCloudinary = uploadValidatedToCloudinary;
module.exports.cleanupUploadedFile = cleanupUploadedFile;
