"use strict";

function slugify(input) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function uniqueSlug(Model, base, field = "Slug", extraFilter = {}) {
  let slug = slugify(base) || "item";
  let i = 0;
  for (;;) {
    const candidate = i === 0 ? slug : `${slug}-${i}`;
    const exists = await Model.findOne({ [field]: candidate, ...extraFilter })
      .select("_id")
      .lean();
    if (!exists) return candidate;
    i += 1;
    if (i > 500) return `${slug}-${Date.now().toString(36)}`;
  }
}

module.exports = { slugify, uniqueSlug };
