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

async function registerCredential({
  userId,
  challenge,
  credentialId,
  publicKey,
  transports,
  deviceName,
  clientDataJSON,
}) {
  if (!credentialId) throw new ValidationError('Thiếu credentialId.');
  if (clientDataJSON && !assertClientDataChallenge(clientDataJSON, challenge)) {
    // register type is webauthn.create — allow either in helper after fix
    try {
      const json = JSON.parse(Buffer.from(String(clientDataJSON), 'base64url').toString('utf8'));
      if (json.type === 'webauthn.create') {
        const ch = json.challenge;
        if (ch !== challenge) throw new UnauthorizedError('clientDataJSON challenge không khớp.');
      } else if (!assertClientDataChallenge(clientDataJSON, challenge)) {
        throw new UnauthorizedError('clientDataJSON challenge không khớp.');
      }
    } catch (e) {
      if (e.statusCode) throw e;
      throw new UnauthorizedError('clientDataJSON không hợp lệ.');
    }
  }
  if (process.env.WEBAUTHN_REQUIRE_PUBLIC_KEY === '1' && !publicKey) {
    throw new ValidationError('Thiếu publicKey credential.');
  }
  await consumeChallenge({ challenge, purpose: 'register', userId });
  try {
    const doc = await WebAuthnCredential.create({
      UserID: userId,
      CredentialId: String(credentialId),
      PublicKey: String(publicKey || '').slice(0, 8000),
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
 * Parse browser clientDataJSON (base64url) and ensure challenge matches.
 */
function assertClientDataChallenge(clientDataJSON, expectedChallenge) {
  if (!clientDataJSON) return false;
  try {
    const json = JSON.parse(Buffer.from(String(clientDataJSON), 'base64url').toString('utf8'));
    if (json.type !== 'webauthn.get' && json.type !== 'webauthn.create') return false;
    // Browser stores challenge as base64url of the raw challenge bytes we supplied
    const ch = json.challenge;
    if (!ch) return false;
    return ch === expectedChallenge || Buffer.from(ch, 'base64url').toString('base64url') === expectedChallenge;
  } catch {
    return false;
  }
}

/**
 * Optional full crypto verify via @simplewebauthn/server when installed.
 * Returns: 'verified' | 'failed' | 'skipped'
 */
async function trySimpleWebAuthnVerify({
  credential,
  challenge,
  credentialId,
  clientDataJSON,
  authenticatorData,
  signature,
  host,
}) {
  let verifyAuthenticationResponse;
  try {
    // Optional dependency — not in package.json by default
    ({ verifyAuthenticationResponse } = require('@simplewebauthn/server'));
  } catch {
    return 'skipped';
  }
  if (!clientDataJSON || !authenticatorData || !signature || !credential.PublicKey) {
    return 'skipped';
  }
  try {
    const expectedOrigin =
      process.env.WEBAUTHN_ORIGIN ||
      process.env.PUBLIC_BASE_URL ||
      `http://${host || 'localhost'}`;
    const rpID = rpIdFromHost(host || 'localhost');
    const verification = await verifyAuthenticationResponse({
      response: {
        id: String(credentialId),
        rawId: String(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: String(clientDataJSON),
          authenticatorData: String(authenticatorData),
          signature: String(signature),
        },
      },
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: credential.CredentialId,
        publicKey: Buffer.from(String(credential.PublicKey), 'base64url'),
        counter: credential.Counter || 0,
      },
      requireUserVerification: false,
    });
    return verification && verification.verified ? 'verified' : 'failed';
  } catch (err) {
    if (process.env.WEBAUTHN_STRICT === '1') {
      throw new UnauthorizedError(
        `WebAuthn verify thất bại: ${err.message || 'invalid assertion'}`
      );
    }
    return 'failed';
  }
}

/**
 * Assertion verify:
 * - consume challenge (bound to user when issued at login options)
 * - credential must exist
 * - if clientDataJSON provided, challenge must match (real browser flow)
 * - signature required when WEBAUTHN_REQUIRE_SIGNATURE=1
 * - optional COSE verify via @simplewebauthn/server when installed
 */
async function verifyLoginAssertion({
  challenge,
  credentialId,
  signature,
  clientDataJSON,
  authenticatorData,
  counter,
  host,
}) {
  if (!credentialId) throw new ValidationError('Thiếu credentialId.');
  if (process.env.WEBAUTHN_REQUIRE_SIGNATURE === '1' && !signature) {
    throw new ValidationError('Thiếu chữ ký WebAuthn.');
  }
  if (clientDataJSON && !assertClientDataChallenge(clientDataJSON, challenge)) {
    throw new UnauthorizedError('clientDataJSON challenge không khớp.');
  }

  const challengeDoc = await consumeChallenge({ challenge, purpose: 'login' });
  const cred = await WebAuthnCredential.findOne({ CredentialId: String(credentialId) });
  if (!cred) throw new UnauthorizedError('Passkey không hợp lệ.');

  // Challenge was issued for a specific user — must match credential owner
  if (challengeDoc.UserID && String(challengeDoc.UserID) !== String(cred.UserID)) {
    throw new UnauthorizedError('Passkey không khớp tài khoản challenge.');
  }

  const cryptoResult = await trySimpleWebAuthnVerify({
    credential: cred,
    challenge,
    credentialId,
    clientDataJSON,
    authenticatorData,
    signature,
    host,
  });
  if (cryptoResult === 'failed' && process.env.WEBAUTHN_STRICT === '1') {
    throw new UnauthorizedError('Chữ ký WebAuthn không hợp lệ.');
  }

  // Counter must not go backwards (clone detection)
  if (counter != null && Number(counter) < (cred.Counter || 0)) {
    throw new UnauthorizedError('WebAuthn counter rollback — từ chối.');
  }
  cred.LastUsedAt = new Date();
  cred.Counter = counter != null ? Number(counter) : (cred.Counter || 0) + 1;
  if (authenticatorData) {
    cred.PublicKey = cred.PublicKey || ''; // keep
  }
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
  trySimpleWebAuthnVerify,
  listCredentials,
  revokeCredential,
  rpIdFromHost,
  assertClientDataChallenge,
};
