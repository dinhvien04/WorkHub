"use strict";

/**
 * First-party Multer storage for Cloudinary 2.x.
 * Avoids multer-storage-cloudinary peer range lock on cloudinary@1.
 *
 * Implements multer StorageEngine:
 *   _handleFile(req, file, cb)
 *   _removeFile(req, file, cb)
 */
const crypto = require("crypto");

function CloudinaryStorage(opts = {}) {
  if (!(this instanceof CloudinaryStorage)) {
    return new CloudinaryStorage(opts);
  }
  this.cloudinary = opts.cloudinary;
  this.params = opts.params || (() => ({}));
}

CloudinaryStorage.prototype._handleFile = function _handleFile(req, file, cb) {
  const cloudinary = this.cloudinary;
  if (!cloudinary || !cloudinary.uploader) {
    return cb(new Error("Cloudinary client not configured"));
  }

  Promise.resolve()
    .then(async () => {
      const params =
        typeof this.params === "function"
          ? await this.params(req, file)
          : this.params || {};

      const folder = params.folder || "coworking/misc";
      const publicId =
        params.public_id ||
        params.publicId ||
        crypto.randomBytes(16).toString("hex");
      const resourceType =
        params.resource_type || params.resourceType || "auto";
      const allowed =
        params.allowed_formats || params.allowedFormats || undefined;

      const uploadOpts = {
        folder,
        public_id: publicId,
        resource_type: resourceType,
        overwrite: false,
        unique_filename: false,
        use_filename: false,
      };
      if (allowed) uploadOpts.allowed_formats = allowed;
      // Prefer secure URLs (Cloudinary 2.x default is secure)
      uploadOpts.secure = true;

      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          uploadOpts,
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          },
        );
        file.stream.pipe(stream);
      });
    })
    .then((result) => {
      cb(null, {
        fieldname: file.fieldname,
        originalname: file.originalname,
        encoding: file.encoding,
        mimetype: file.mimetype,
        path: result.secure_url || result.url,
        filename: result.public_id,
        public_id: result.public_id,
        size: result.bytes,
        format: result.format,
        resource_type: result.resource_type,
        // Multer-compatible extras
        destination: result.folder || "",
        url: result.secure_url || result.url,
      });
    })
    .catch((err) => cb(err));
};

CloudinaryStorage.prototype._removeFile = function _removeFile(req, file, cb) {
  const cloudinary = this.cloudinary;
  const publicId = file.public_id || file.filename;
  if (!cloudinary || !publicId) return cb(null);
  const resourceType = file.resource_type || "image";
  cloudinary.uploader.destroy(
    publicId,
    { resource_type: resourceType === "raw" ? "raw" : resourceType },
    (err) => cb(err || null),
  );
};

/**
 * Destroy by public_id with optional resource type.
 */
async function destroyUpload(cloudinary, publicId, resourceType = "image") {
  if (!cloudinary || !publicId) return null;
  return cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
}

/**
 * Best-effort orphan cleanup after failed registration/profile update.
 */
async function cleanupUploadedFile(cloudinary, file) {
  if (!file) return;
  const publicId = file.public_id || file.filename;
  if (!publicId) return;
  try {
    await destroyUpload(cloudinary, publicId, file.resource_type || "auto");
  } catch {
    /* ignore cleanup errors */
  }
}

module.exports = {
  CloudinaryStorage,
  destroyUpload,
  cleanupUploadedFile,
};
