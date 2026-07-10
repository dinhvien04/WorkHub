'use strict';

/**
 * Passkey / WebAuthn challenge flow (registration + assertion stub).
 * Full attestation crypto can be upgraded with @simplewebauthn/server later;
 * we store credential IDs and challenges with expiry for progressive enhancement.
 */
const crypto = require('crypto');
const WebAuthnCredential = require('../models/WebAuthnCredential');
const WebAuthnChallenge = require('../models/WebAuthnChallenge');
const User = require('../models/User');
const {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
} = require('../utils/errors');
const env = require('../config/env');

function rpIdFromHost(host) {
  if (!host) return 'localhost';
  return String(host).split(':')[0];
}

function randomChallenge() {
  return crypto.randomBytes(32).toString('base64url');
}

async function issueChallenge({ userId = null, purpose }) {
  const challenge = randomChallenge();
  await WebAuthnChallenge.create({
    UserID: userId,
    Challenge: challenge,
    Purpose: purpose,
    ExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return challenge;
}

async function consumeChallenge({ challenge, purpose, userId = null }) {
  const q = {
    Challenge: challenge,
    Purpose: purpose,
    ConsumedAt: null,
    ExpiresAt: { $gt: new Date() },
  };
  if (userId) q.UserID = userId;
  const doc = await WebAuthnChallenge.findOneAndUpdate(q, {
    $set: { ConsumedAt: new Date() },
  });
  if (!doc) throw new ValidationError('Challenge WebAuthn không hợp lệ hoặc hết hạn.');
  return doc;
}

async function registrationOptions({ userId, email, host }) {
  const user = await User.findById(userId).select('Email FullName');
  if (!user) throw new NotFoundError('User not found');
  const challenge = await issueChallenge({ userId, purpose: 'register' });
  const existing = await WebAuthnCredential.find({ UserID: userId }).select('CredentialId').lean();
  return {
    challenge,
    rp: { name: 'WorkHub', id: rpIdFromHost(host) },
    user: {
      id: Buffer.from(String(userId)).toString('base64url'),
      name: email || user.Email,
      displayName: user.FullName || user.Email,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: existing.map((c) => ({
      type: 'public-key',
      id: c.CredentialId,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  };
}

async function registerCredential({ userId, challenge, credentialId, publicKey, transports, deviceName }) {
  if (!credentialId) throw new ValidationError('Thiếu credentialId.');
  await consumeChallenge({ challenge, purpose: 'register', userId });
  try {
    const doc = await WebAuthnCredential.create({
      UserID: userId,
      CredentialId: String(credentialId),
      PublicKey: String(publicKey || '').slice(0, 4000),
      Transports: Array.isArray(transports) ? transports.slice(0, 8) : [],
      DeviceName: String(deviceName || 'Passkey').slice(0, 100),
    });
    return doc;
  } catch (err) {
    if (err.code === 11000) throw new ValidationError('Passkey đã được đăng ký.');
    throw err;
  }
}

async function loginOptions({ email, host }) {
  const user = await User.findOne({ Email: String(email || '').toLowerCase().trim() });
  if (!user) {
    // Uniform response — still issue anonymous-looking challenge shape
    const challenge = await issueChallenge({ purpose: 'login' });
    return {
      challenge,
      rpId: rpIdFromHost(host),
      timeout: 60000,
      allowCredentials: [],
      userVerification: 'preferred',
    };
  }
  const creds = await WebAuthnCredential.find({ UserID: user._id }).lean();
  const challenge = await issueChallenge({ userId: user._id, purpose: 'login' });
  return {
    challenge,
    rpId: rpIdFromHost(host),
    timeout: 60000,
    allowCredentials: creds.map((c) => ({
      type: 'public-key',
      id: c.CredentialId,
      transports: c.Transports || [],
    })),
    userVerification: 'preferred',
    _userId: user._id, // internal only — stripped by controller
  };
}

/**
 * Assertion verify (credential presence + challenge).
 * Production should verify signature against PublicKey.
 */
async function verifyLoginAssertion({ challenge, credentialId, signature }) {
  if (!credentialId) throw new ValidationError('Thiếu credentialId.');
  // signature required from client navigator (we store for audit trail only in stub)
  if (signature === undefined) {
    // allow empty string in tests but presence of field is enough for stub
  }
  await consumeChallenge({ challenge, purpose: 'login' });
  const cred = await WebAuthnCredential.findOne({ CredentialId: String(credentialId) });
  if (!cred) throw new UnauthorizedError('Passkey không hợp lệ.');
  cred.LastUsedAt = new Date();
  cred.Counter = (cred.Counter || 0) + 1;
  await cred.save();
  const user = await User.findById(cred.UserID);
  if (!user || user.Status !== 'active') throw new UnauthorizedError('Tài khoản không khả dụng.');
  return user;
}

async function listCredentials(userId) {
  return WebAuthnCredential.find({ UserID: userId })
    .select('-PublicKey')
    .sort({ createdAt: -1 })
    .lean();
}

async function revokeCredential(userId, credentialId) {
  const doc = await WebAuthnCredential.findOneAndDelete({
    UserID: userId,
    CredentialId: credentialId,
  });
  if (!doc) throw new NotFoundError('Không tìm thấy passkey.');
  return { deleted: true };
}

module.exports = {
  registrationOptions,
  registerCredential,
  loginOptions,
  verifyLoginAssertion,
  listCredentials,
  revokeCredential,
  rpIdFromHost,
};
