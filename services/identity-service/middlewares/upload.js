"use strict";

/**
 * Identity-service does not process host verification documents.
 * Keep a no-op middleware surface so authController register path stays compatible.
 */
function single(_field) {
  return (req, _res, next) => next();
}

module.exports = {
  single,
  singleWithMagic: null,
  cloudinary: null,
};
