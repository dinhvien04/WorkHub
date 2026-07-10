'use strict';

/**
 * Google OIDC (Authorization Code).
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
 * Dev/test mock: ALLOW_GOOGLE_MOCK=1 or NODE_ENV=test → /api/auth/google/mock
 */
const crypto = require('crypto');
const User = require('../models/User');
const env = require('../config/env');
const { ValidationError, UnauthorizedError } = require('../utils/errors');

const states = new Map(); // state -> { exp, nonce }

function configured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function mockAllowed() {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.ALLOW_GOOGLE_MOCK === '1' ||
    process.env.ALLOW_GOOGLE_MOCK === 'true'
  );
}

function redirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const host = req.get('host');
  const proto = req.protocol || 'http';
  return `${proto}://${host}/api/auth/google/callback`;
}

function createState() {
  const state = crypto.randomBytes(24).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  states.set(state, { exp: Date.now() + 10 * 60 * 1000, nonce });
  // prune occasionally
  if (states.size > 500) {
    const now = Date.now();
    for (const [k, v] of states) {
      if (v.exp < now) states.delete(k);
    }
  }
  return { state, nonce };
}

function consumeState(state) {
  const row = states.get(state);
  states.delete(state);
  if (!row || row.exp < Date.now()) return null;
  return row;
}

function authorizationUrl(req) {
  if (!configured()) {
    throw new ValidationError(
      'Google OIDC chưa cấu hình (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).'
    );
  }
  const { state, nonce } = createState();
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    access_type: 'online',
    prompt: 'select_account',
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    state,
  };
}

async function exchangeCode(req, code) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(req),
    grant_type: 'authorization_code',
  });
  const res = await globalThis.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new UnauthorizedError(`Google token exchange failed: ${res.status} ${t}`);
  }
  return res.json();
}

function decodeIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length < 2) throw new UnauthorizedError('id_token không hợp lệ.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  return payload;
}

async function upsertGoogleUser(profile) {
  const email = String(profile.email || '').toLowerCase().trim();
  const sub = profile.sub;
  if (!email || !sub) throw new ValidationError('Google profile thiếu email/sub.');

  let user = await User.findOne({ $or: [{ GoogleSub: sub }, { Email: email }] });
  if (user) {
    if (user.Status === 'banned') throw new UnauthorizedError('Tài khoản đã bị khóa.');
    user.GoogleSub = sub;
    // Keep local provider if password account; still link GoogleSub
    if (user.AuthProvider !== 'local') user.AuthProvider = 'google';
    user.EmailVerified = true;
    user.EmailVerifiedAt = user.EmailVerifiedAt || new Date();
    if (user.Status === 'inactive' && user.Role === 'customer') {
      user.Status = 'active';
    }
    if (profile.name && !user.FullName) user.FullName = profile.name;
    await user.save();
    return user;
  }

  const randomPass = crypto.randomBytes(32).toString('hex');
  const bcrypt = require('bcryptjs');
  user = await User.create({
    Email: email,
    FullName: profile.name || email.split('@')[0],
    PasswordHash: await bcrypt.hash(randomPass, 10),
    Role: 'customer',
    Status: 'active',
    AuthProvider: 'google',
    GoogleSub: sub,
    EmailVerified: true,
    EmailVerifiedAt: new Date(),
    tokenVersion: 0,
  });
  try {
    const CustomerProfile = require('../models/Customer_Profile');
    await CustomerProfile.create({ UserID: user._id, Phone: '', Avatar: profile.picture || '' });
  } catch {
    /* ignore */
  }
  return user;
}

async function handleCallback(req, { code, state }) {
  if (!configured()) throw new ValidationError('Google OIDC chưa cấu hình.');
  if (!code || !state) throw new ValidationError('Thiếu code/state.');
  const st = consumeState(state);
  if (!st) throw new UnauthorizedError('State OAuth không hợp lệ hoặc hết hạn.');
  const tokens = await exchangeCode(req, code);
  const profile = decodeIdToken(tokens.id_token);
  if (st.nonce && profile.nonce && st.nonce !== profile.nonce) {
    throw new UnauthorizedError('Nonce OIDC không khớp.');
  }
  if (profile.email_verified === false) {
    throw new UnauthorizedError('Email Google chưa verified.');
  }
  return upsertGoogleUser(profile);
}

/** Test/dev only — no real Google call */
async function mockLogin({ email, name }) {
  if (!mockAllowed()) {
    throw new ValidationError('Google mock chỉ bật khi test hoặc ALLOW_GOOGLE_MOCK=1.');
  }
  const em = String(email || 'google.user@example.com').toLowerCase();
  return upsertGoogleUser({
    sub: `mock-google-${crypto.createHash('sha256').update(em).digest('hex').slice(0, 24)}`,
    email: em,
    name: name || 'Google User',
    email_verified: true,
    picture: '',
  });
}

module.exports = {
  configured,
  mockAllowed,
  authorizationUrl,
  handleCallback,
  mockLogin,
  upsertGoogleUser,
};
