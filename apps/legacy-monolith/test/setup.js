'use strict';

process.env.NODE_ENV = 'test';
// Prefer test secret if not already set (dotenv won't override)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET =
    'test_jwt_secret_key_at_least_32_characters_long_for_workhub';
}
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/workhub_test';
}
process.env.ENABLE_TRANSACTIONS = 'false';
process.env.PORT = process.env.PORT || '0';
// Do NOT set DISABLE_CSRF globally — security tests must exercise CSRF.

// Global teardown: close mongoose / memory mongo leftovers so tests can run without --forceExit
afterAll(async () => {
  try {
    const helpers = require('./helpers');
    if (helpers && typeof helpers.stopMemoryMongo === 'function') {
      await helpers.stopMemoryMongo();
    }
  } catch {
    /* ignore */
  }
});
