'use strict';

const pkg = require('../package.json');

/**
 * Expose API version headers on every response.
 */
function apiVersion(req, res, next) {
  res.setHeader('X-WorkHub-Version', pkg.version || '0.0.0');
  res.setHeader('X-API-Version', '1');
  next();
}

module.exports = apiVersion;
