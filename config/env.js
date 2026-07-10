'use strict';

/**
 * Central environment validation. Fail fast if required secrets are missing.
 * Never use fallback secrets in application code.
 */
require('dotenv').config();

const REQUIRED = ['JWT_SECRET', 'MONGODB_URI'];

function validateEnv() {
  const missing = REQUIRED.filter((key) => {
    const val = process.env[key];
    return !val || String(val).trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and set real values. ' +
        "Generate JWT_SECRET with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
    );
  }

  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }

  const forbidden = [
    'workhub_fallback_secret_key_2026',
    'YOUR_SECRET_KEY',
    'fallback-secret',
    'replace_with_a_long_random_secret',
  ];
  if (process.env.NODE_ENV === 'production') {
    for (const bad of forbidden) {
      if (process.env.JWT_SECRET.includes(bad)) {
        throw new Error('JWT_SECRET looks like a placeholder; set a real secret in production.');
      }
    }
  }
}

validateEnv();

function boolEnv(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  return v === '1' || v === 'true' || v === 'TRUE';
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 3000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',
  SESSION_SECRET: process.env.SESSION_SECRET || process.env.JWT_SECRET,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
  COOKIE_SECURE: process.env.NODE_ENV === 'production',
  TRUST_PROXY: boolEnv('TRUST_PROXY', false),
  BOOKING_SLOT_MINUTES: Number(process.env.BOOKING_SLOT_MINUTES) || 30,
  MAX_BOOKING_HOURS: Number(process.env.MAX_BOOKING_HOURS) || 24,
  MAX_BOOKING_DAYS_AHEAD: Number(process.env.MAX_BOOKING_DAYS_AHEAD) || 180,
  // Explicit: never auto-retry transaction callback. Default false in test/dev unless set.
  ENABLE_TRANSACTIONS: boolEnv(
    'ENABLE_TRANSACTIONS',
    process.env.NODE_ENV === 'production'
  ),
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || '',
  EMAIL_FROM: process.env.EMAIL_FROM || '',
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  CSRF_COOKIE_NAME: 'csrfToken',
  AUTH_COOKIE_NAME: 'authToken',
  isDev: (process.env.NODE_ENV || 'development') !== 'production',
  isTest: process.env.NODE_ENV === 'test',
  isProduction: process.env.NODE_ENV === 'production',
};

module.exports = env;
