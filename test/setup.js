'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test_jwt_secret_key_at_least_32_characters_long_for_workhub';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/workhub_test';
process.env.DISABLE_CSRF = '1';
process.env.PORT = process.env.PORT || '0';
