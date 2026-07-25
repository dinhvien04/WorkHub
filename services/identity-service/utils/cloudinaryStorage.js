"use strict";

async function cleanupUploadedFile(_cloudinary, _file) {
  // Identity-service does not host Cloudinary uploads.
  return;
}

module.exports = { cleanupUploadedFile };
