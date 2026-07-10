'use strict';

function parsePagination(query = {}, defaults = { page: 1, limit: 20, maxLimit: 100 }) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = defaults.page;
  if (!Number.isFinite(limit) || limit < 1) limit = defaults.limit;
  limit = Math.min(limit, defaults.maxLimit || 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function paginationMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

module.exports = { parsePagination, paginationMeta };
