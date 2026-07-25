"use strict";

const sanitizeHtml = require("sanitize-html");

const explicitOptions = {
  // Explicitly allow only a safe subset of tags (blocking script, iframe, object, embed, svg, math, form, input, button)
  allowedTags: [
    "address", "article", "aside", "footer", "header", "h1", "h2", "h3", "h4",
    "h5", "h6", "hgroup", "main", "nav", "section", "blockquote", "dd", "div",
    "dl", "dt", "figcaption", "figure", "hr", "li", "ol", "p", "pre", "ul",
    "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em",
    "i", "kbd", "mark", "q", "rb", "rp", "rt", "rtc", "ruby", "s", "samp",
    "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "caption",
    "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr"
  ],
  // Explicitly allow only safe attributes (blocking onclick, onerror, onload, srcdoc)
  allowedAttributes: {
    a: ["href", "name", "target", "title", "rel"],
    img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
    div: ["class"],
    span: ["class"],
    p: ["class"],
  },
  // Explicitly block all inline style attributes to prevent CSS-based injection vectors
  allowedStyles: {},
  // Only allow explicitly safe URL schemes (blocking javascript:, data:, vbscript:)
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    a: ["http", "https", "mailto"],
    img: ["http", "https"],
  },
  // Ensure protocol-relative urls are not allowed to avoid open redirects
  allowProtocolRelative: false,
};

/**
 * Sanitize rich HTML content to prevent stored XSS attacks.
 */
function clean(htmlText) {
  if (!htmlText || typeof htmlText !== "string") {
    return "";
  }
  return sanitizeHtml(htmlText, explicitOptions).trim();
}

module.exports = {
  clean,
};
