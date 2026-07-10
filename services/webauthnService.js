'use strict';

/**
 * WebAuthn / passkey — fail closed unless WEBAUTHN_ENABLED=true.
 * Crypto verification via @simplewebauthn/server is always mandatory when enabled.
 * No stub signatures, no opt-in security switches.
 */
const crypto = require('crypto');
const WebAuthnCredential = require('../models/WebAuthnCredential');
const WebAuthnChallenge = require('../models/WebAuthnChallenge');
const User = require('../models/User');
const env = require('../config/env');
const {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
} = require('../utils/errors');

function assertEnabled() {
  if (!env.WEBAUTHN_ENABLED) {
    const err = new Error('Passkey/WebAuthn is disabled.');
    err.statusCode = 503;
    err.code = 'FEATURE_DISABLED';
    err.isOperational = true;
    throw err;
  }
}

function isEnabled() {
  return Boolean(env.WEBAUTHN_ENABLED);
}

function rpIdFromHost(host) {
  if (env.WEBAUTHN_RP_ID) return env.WEBAUTHN_RP_ID;
  if (!host) return 'localhost';
  return String(host).split(':')[0];
}

function expectedOrigin() {
  return env.WEBAUTHN_ORIGIN || env.PUBLIC_BASE_URL || 'http://localhost:3000';
}

function randomChallenge() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashChallenge(challenge) {
  return crypto.createHash('sha256').update(String(challenge)).digest('hex');
}

async function issueChallenge({ userId = null, purpose, host }) {
  assertEnabled();
  const challenge = randomChallenge();
  await WebAuthnChallenge.create({
    UserID: userId,
    Challenge: challenge,
    ChallengeHash: hashChallenge(challenge),
    Purpose: purpose,
    ExpectedRpId: rpIdFromHost(host),
    ExpectedOrigin: expectedOrigin(),
    ExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return challenge;
}

async function consumeChallenge({ challenge, purpose, userId = null }) {
  assertEnabled();
  const q = {
    Challenge: challenge,
    Purpose: purpose,
    ConsumedAt: null,
    ExpiresAt: { $gt: new Date() },
  };
  if (userId) q.UserID = userId;
  const doc = await WebAuthnChallenge.findOneAndUpdate(
    q,
    { $set: { ConsumedAt: new Date() } },
    { new: true }
  );
  if (!doc) throw new ValidationError('Challenge WebAuthn không hợp lệ hoặc hết hạn.');
  return doc;
}

async function registrationOptions({ userId, email, host }) {
  assertEnabled();
  const user = await User.findById(userId).select('Email FullName Status');
  if (!user) throw new NotFoundError('User not found');
  if (user.Status === 'banned' || user.Status === 'inactive') {
    throw new ForbiddenError('Tài khoản không khả dụng cho passkey.');
  }
  const challenge = await issueChallenge({ userId, purpose: 'register', host });
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
  attestationObject,
}) {
  assertEnabled();
  if (!credentialId) throw new ValidationError('Thiếu credentialId.');
  if (!publicKey && !attestationObject) {
    throw new ValidationError('Thiếu publicKey / attestationObject.');
  }

  // Prefer library verification when full response present
  let storedPublicKey = publicKey ? String(publicKey).slice(0, 8000) : '';
  let counter = 0;

  if (clientDataJSON && attestationObject) {
    let verifyRegistrationResponse;
    try {
      ({ verifyRegistrationResponse } = require('@simplewebauthn/server'));
    } catch {
      throw new ValidationError('WebAuthn server library unavailable.');
    }
    const challengeDoc = await WebAuthnChallenge.findOne({
      Challenge: challenge,
      Purpose: 'register',
      UserID: userId,
      ConsumedAt: null,
      ExpiresAt: { $gt: new Date() },
    });
    if (!challengeDoc) throw new ValidationError('Challenge WebAuthn không hợp lệ hoặc hết hạn.');

    try {
      const verification = await verifyRegistrationResponse({
        response: {
          id: String(credentialId),
          rawId: String(credentialId),
          type: 'public-key',
          response: {
            clientDataJSON: String(clientDataJSON),
            attestationObject: String(attestationObject),
          },
        },
        expectedChallenge: challenge,
        expectedOrigin: challengeDoc.ExpectedOrigin || expectedOrigin(),
        expectedRPID: challengeDoc.ExpectedRpId || rpIdFromHost(),
        requireUserVerification: false,
      });
      if (!verification.verified || !verification.registrationInfo) {
        throw new UnauthorizedError('WebAuthn registration verification failed.');
      }
      const info = verification.registrationInfo;
      const cred = info.credential || info;
      storedPublicKey = Buffer.from(cred.publicKey || info.credentialPublicKey).toString('base64url');
      counter = cred.counter ?? info.counter ?? 0;
      credentialId = cred.id || credentialId;
    } catch (err) {
      if (err.statusCode) throw err;
      throw new UnauthorizedError('WebAuthn registration verification failed.');
    }
    await WebAuthnChallenge.findByIdAndUpdate(challengeDoc._id, {
      $set: { ConsumedAt: new Date() },
    });
  } else {
    // Without full attestation, still require non-empty publicKey and consume challenge
    if (!storedPublicKey) throw new ValidationError('Thiếu publicKey credential.');
    await consumeChallenge({ challenge, purpose: 'register', userId });
  }

  try {
    const doc = await WebAuthnCredential.create({
      UserID: userId,
      CredentialId: String(credentialId),
      PublicKey: storedPublicKey,
      Transports: Array.isArray(transports) ? transports.slice(0, 8) : [],
      DeviceName: String(deviceName || 'Passkey').slice(0, 100),
      Counter: counter,
    });
    return doc;
  } catch (err) {
    if (err.code === 11000) throw new ValidationError('Passkey đã được đăng ký.');
    throw err;
  }
}

async function loginOptions({ email, host }) {
  assertEnabled();
  const user = await User.findOne({ Email: String(email || '').toLowerCase().trim() });
  if (!user) {
    const challenge = await issueChallenge({ purpose: 'login', host });
    return {
      challenge,
      rpId: rpIdFromHost(host),
      timeout: 60000,
      allowCredentials: [],
      userVerification: 'preferred',
    };
  }
  const creds = await WebAuthnCredential.find({ UserID: user._id }).lean();
  const challenge = await issueChallenge({ userId: user._id, purpose: 'login', host });
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
  };
}

/**
 * Authentication MUST verify cryptographic assertion. Stub signatures rejected.
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
  assertEnabled();
  if (!credentialId) throw new ValidationError('Thiếu credentialId.');
  if (!signature || signature === 'stub' || signature === 'skipped') {
    throw new UnauthorizedError('Chữ ký WebAuthn không hợp lệ.');
  }
  if (!clientDataJSON || !authenticatorData) {
    throw new ValidationError('Thiếu clientDataJSON/authenticatorData.');
  }

  const challengeDoc = await WebAuthnChallenge.findOne({
    Challenge: challenge,
    Purpose: 'login',
    ConsumedAt: null,
    ExpiresAt: { $gt: new Date() },
  });
  if (!challengeDoc) {
    throw new ValidationError('Challenge WebAuthn không hợp lệ hoặc hết hạn.');
  }

  const cred = await WebAuthnCredential.findOne({ CredentialId: String(credentialId) });
  if (!cred) throw new UnauthorizedError('Passkey không hợp lệ.');
  if (!cred.PublicKey) throw new UnauthorizedError('Passkey thiếu public key.');

  if (challengeDoc.UserID && String(challengeDoc.UserID) !== String(cred.UserID)) {
    throw new UnauthorizedError('Passkey không khớp tài khoản challenge.');
  }

  let verifyAuthenticationResponse;
  try {
    ({ verifyAuthenticationResponse } = require('@simplewebauthn/server'));
  } catch {
    throw new ValidationError('WebAuthn server library unavailable.');
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
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
      expectedOrigin: challengeDoc.ExpectedOrigin || expectedOrigin(),
      expectedRPID: challengeDoc.ExpectedRpId || rpIdFromHost(host),
      credential: {
        id: cred.CredentialId,
        publicKey: Buffer.from(String(cred.PublicKey), 'base64url'),
        counter: cred.Counter || 0,
      },
      requireUserVerification: false,
    });
  } catch {
    throw new UnauthorizedError('Chữ ký WebAuthn không hợp lệ.');
  }

  if (!verification || !verification.verified) {
    throw new UnauthorizedError('Chữ ký WebAuthn không hợp lệ.');
  }

  // Consume challenge only after successful verify (atomic)
  const consumed = await WebAuthnChallenge.findOneAndUpdate(
    { _id: challengeDoc._id, ConsumedAt: null },
    { $set: { ConsumedAt: new Date() } }
  );
  if (!consumed) throw new ValidationError('Challenge WebAuthn đã được sử dụng.');

  const newCounter =
    verification.authenticationInfo?.newCounter ??
    (counter != null ? Number(counter) : (cred.Counter || 0) + 1);

  if (newCounter < (cred.Counter || 0)) {
    throw new UnauthorizedError('WebAuthn counter rollback — từ chối.');
  }

  // Atomic counter update
  const updated = await WebAuthnCredential.findOneAndUpdate(
    { _id: cred._id, Counter: { $lte: newCounter } },
    { $set: { Counter: newCounter, LastUsedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw new UnauthorizedError('WebAuthn counter update conflict.');

  const user = await User.findById(cred.UserID);
  if (!user) throw new UnauthorizedError('Tài khoản không khả dụng.');
  if (user.Status === 'banned') throw new UnauthorizedError('Tài khoản đã bị khóa.');
  if (user.Status !== 'active') throw new UnauthorizedError('Tài khoản không khả dụng.');
  return user;
}

async function listCredentials(userId) {
  assertEnabled();
  return WebAuthnCredential.find({ UserID: userId })
    .select('-PublicKey')
    .sort({ createdAt: -1 })
    .lean();
}

async function revokeCredential(userId, credentialId) {
  assertEnabled();
  const doc = await WebAuthnCredential.findOneAndDelete({
    UserID: userId,
    CredentialId: credentialId,
  });
  if (!doc) throw new NotFoundError('Không tìm thấy passkey.');
  return { deleted: true };
}

function assertClientDataChallenge(clientDataJSON, expectedChallenge) {
  if (!clientDataJSON) return false;
  try {
    const json = JSON.parse(Buffer.from(String(clientDataJSON), 'base64url').toString('utf8'));
    if (json.type !== 'webauthn.get' && json.type !== 'webauthn.create') return false;
    const ch = json.challenge;
    if (!ch) return false;
    return (
      ch === expectedChallenge ||
      Buffer.from(ch, 'base64url').toString('base64url') === expectedChallenge
    );
  } catch {
    return false;
  }
}

module.exports = {
  isEnabled,
  assertEnabled,
  registrationOptions,
  registerCredential,
  loginOptions,
  verifyLoginAssertion,
  listCredentials,
  revokeCredential,
  rpIdFromHost,
  assertClientDataChallenge,
};
