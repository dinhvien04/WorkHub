'use strict';

/**
 * Integer minor-unit money helpers (VND has no fractional subunit;
 * we still store whole đồng as integer "minor" units).
 */
const DEFAULT_CURRENCY = 'VND';

function toMinor(amount) {
  if (amount == null || amount === '') return 0;
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    const err = new Error('Invalid money amount');
    err.statusCode = 400;
    err.isOperational = true;
    throw err;
  }
  // Reject fractional VND
  if (!Number.isInteger(n) && Math.abs(n - Math.round(n)) > 1e-9) {
    const err = new Error('Money must be integer minor units (no float VND)');
    err.statusCode = 400;
    err.isOperational = true;
    throw err;
  }
  return Math.round(n);
}

function assertNonNegativeMinor(amount) {
  const m = toMinor(amount);
  if (m < 0) {
    const err = new Error('Money amount cannot be negative');
    err.statusCode = 400;
    err.isOperational = true;
    throw err;
  }
  return m;
}

function formatVnd(minor) {
  return `${Number(minor || 0).toLocaleString('vi-VN')}đ`;
}

function moneyDto(amount, currency = DEFAULT_CURRENCY) {
  return {
    amount: toMinor(amount),
    currency: String(currency || DEFAULT_CURRENCY).toUpperCase(),
  };
}

function addMinor(a, b) {
  return toMinor(a) + toMinor(b);
}

function subMinor(a, b) {
  return toMinor(a) - toMinor(b);
}

module.exports = {
  DEFAULT_CURRENCY,
  toMinor,
  assertNonNegativeMinor,
  formatVnd,
  moneyDto,
  addMinor,
  subMinor,
};
