"use strict";

const sanitizeHtml = require("sanitize-html");

const defaultOptions = {
  allowedTags: [
    "address", "article", "aside", "footer", "header", "h1", "h2", "h3", "h4",
    "h5", "h6", "hgroup", "main", "nav", "section", "blockquote", "dd", "div",
    "dl", "dt", "figcaption", "figure", "hr", "li", "main", "ol", "p", "pre",
    "ul", "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn",
    "em", "i", "kbd", "mark", "q", "rb", "rp", "rt", "rtc", "ruby", "s", "samp",
    "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "caption",
    "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr"
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "title", "rel"],
    img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
    span: ["class", "style"],
    div: ["class", "style"],
    p: ["class", "style"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
};

/**
 * Sanitize rich HTML content to prevent stored XSS attacks.
 */
function clean(htmlText) {
  if (!htmlText || typeof htmlText !== "string") {
    return "";
  }
  return sanitizeHtml(htmlText, defaultOptions).trim();
}

module.exports = {
  clean,
};
