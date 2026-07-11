"use strict";

/**
 * Escape user input before using in RegExp / Mongo $regex to prevent ReDoS.
 */
function escapeRegex(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeRegexQuery(input, maxLen = 100) {
  const trimmed = String(input || "")
    .trim()
    .slice(0, maxLen);
  if (!trimmed) return null;
  return { $regex: escapeRegex(trimmed), $options: "i" };
}

module.exports = { escapeRegex, safeRegexQuery };
