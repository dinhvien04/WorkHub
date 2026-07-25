"use strict";

const env = require("../config/env");

/**
 * Absolute public origin for canonicals, sitemap, emails, OAuth.
 * Production: only PUBLIC_BASE_URL (never request Host).
 * Dev/test: PUBLIC_BASE_URL if set, else request host fallback.
 */
function publicBaseUrl(req) {
  if (env.PUBLIC_BASE_URL) {
    return env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  if (env.isProduction) {
    // Should not reach here — env validates PUBLIC_BASE_URL at boot
    return "";
  }
  if (req) {
    const host = req.get("host") || "localhost";
    const proto = req.protocol || "http";
    return `${proto}://${host}`.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}

/**
 * Validate internal SEO redirect path:
 * - must start with single /
 * - no protocol-relative //
 * - no javascript:/data:
 * - no scheme (http:)
 * - max length / chain depth left to caller
 */
function isSafeInternalPath(path) {
  if (!path || typeof path !== "string") return false;
  const p = path.trim();
  if (!p.startsWith("/")) return false;
  if (p.startsWith("//")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return false;
  if (/[\r\n\0]/.test(p)) return false;
  if (p.length > 512) return false;
  return true;
}

module.exports = { publicBaseUrl, isSafeInternalPath };
