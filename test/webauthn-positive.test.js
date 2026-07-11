'use strict';

/**
 * Positive-path WebAuthn ceremony tests with mocked @simplewebauthn/server.
 */
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
} = require('./helpers');

// Mock before requiring webauthnService
const mockVerifyReg = jest.fn();
const mockVerifyAuth = jest.fn();

jest.mock('@simplewebauthn/server', () => ({
  verifyRegistrationResponse: (...args) => mockVerifyReg(...args),
  verifyAuthenticationResponse: (...args) => mockVerifyAuth(...args),
}));

const webauthnService = require('../services/webauthnService');
const env = require('../config/env');
const WebAuthnCredential = require('../models/WebAuthnCredential');

beforeAll(async () => {
  await startMemoryMongo();
  env.WEBAUTHN_ENABLED = true;
  env.WEBAUTHN_RP_ID = 'localhost';
  env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearDb();
  env.WEBAUTHN_ENABLED = true;
  mockVerifyReg.mockReset();
  mockVerifyAuth.mockReset();
  mockVerifyReg.mockImplementation(async (args) => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: args.response.id,
        publicKey: Buffer.from('fake-public-key-bytes-ok'),
        counter: 0,
      },
    },
  }));
  mockVerifyAuth.mockImplementation(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 3 },
  }));
});

describe('WebAuthn positive ceremony (mocked SDK)', () => {
  test('valid registration stores credential; challenge replay fails', async () => {
    const user = await createUser({ email: 'wa-reg@test.com', role: 'customer' });

    const options = await webauthnService.registrationOptions({
      userId: user._id,
      email: user.Email,
      host: 'localhost',
    });
    expect(options.challenge).toBeTruthy();
    expect(options.rp.id).toBe('localhost');

    const cred = await webauthnService.registerCredential({
      userId: user._id,
      challenge: options.challenge,
      credential: {
        id: 'cred-reg-1',
        rawId: 'cred-reg-1',
        type: 'public-key',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YQ',
          transports: ['internal'],
        },
      },
      deviceName: 'Test Device',
    });
    expect(cred.CredentialId).toBe('cred-reg-1');
    expect(mockVerifyReg).toHaveBeenCalled();

    await expect(
      webauthnService.registerCredential({
        userId: user._id,
        challenge: options.challenge,
        credential: {
          id: 'cred-reg-2',
          rawId: 'cred-reg-2',
          type: 'public-key',
          response: {
            clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
            attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YQ',
          },
        },
      })
    ).rejects.toMatchObject({ statusCode: expect.any(Number) });
  });

  test('valid authentication updates sign counter', async () => {
    const user = await createUser({ email: 'wa-auth@test.com', role: 'customer' });

    const regOpts = await webauthnService.registrationOptions({
      userId: user._id,
      email: user.Email,
      host: 'localhost',
    });
    await webauthnService.registerCredential({
      userId: user._id,
      challenge: regOpts.challenge,
      credential: {
        id: 'cred-auth-1',
        rawId: 'cred-auth-1',
        type: 'public-key',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YQ',
        },
      },
    });

    const loginOpts = await webauthnService.loginOptions({
      email: user.Email,
      host: 'localhost',
    });
    expect(loginOpts.challenge).toBeTruthy();
    expect(loginOpts.allowCredentials.length).toBe(1);

    const before = await WebAuthnCredential.findOne({ UserID: user._id }).lean();
    expect(before.Counter).toBe(0);

    const authed = await webauthnService.verifyLoginAssertion({
      challenge: loginOpts.challenge,
      credential: {
        id: 'cred-auth-1',
        rawId: 'cred-auth-1',
        type: 'public-key',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
          authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAQ',
          signature: 'MEUCIQDfakeSignatureNotStub',
        },
      },
      host: 'localhost',
    });
    expect(authed).toBeTruthy();
    expect(authed.Email || authed._id).toBeTruthy();

    const after = await WebAuthnCredential.findOne({ UserID: user._id }).lean();
    expect(after.Counter).toBe(3);
  });

  test('credential revocation removes from list', async () => {
    const user = await createUser({ email: 'wa-rev@test.com', role: 'customer' });
    const regOpts = await webauthnService.registrationOptions({
      userId: user._id,
      email: user.Email,
      host: 'localhost',
    });
    await webauthnService.registerCredential({
      userId: user._id,
      challenge: regOpts.challenge,
      credential: {
        id: 'cred-rev-1',
        rawId: 'cred-rev-1',
        type: 'public-key',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YQ',
        },
      },
    });

    const listBefore = await webauthnService.listCredentials(user._id);
    expect(listBefore.length).toBeGreaterThanOrEqual(1);

    await webauthnService.revokeCredential(user._id, 'cred-rev-1');
    const listAfter = await webauthnService.listCredentials(user._id);
    expect(
      listAfter.every((c) => String(c.CredentialId || c.id) !== 'cred-rev-1')
    ).toBe(true);
  });

  test('SDK verification failure rejects registration', async () => {
    mockVerifyReg.mockImplementation(async () => {
      throw new Error('origin mismatch');
    });
    const user = await createUser({ email: 'wa-bad@test.com', role: 'customer' });
    const regOpts = await webauthnService.registrationOptions({
      userId: user._id,
      email: user.Email,
      host: 'localhost',
    });
    await expect(
      webauthnService.registerCredential({
        userId: user._id,
        challenge: regOpts.challenge,
        credential: {
          id: 'cred-bad',
          rawId: 'cred-bad',
          type: 'public-key',
          response: {
            clientDataJSON: 'x',
            attestationObject: 'y',
          },
        },
      })
    ).rejects.toMatchObject({ statusCode: expect.any(Number) });
  });

  test('user verification required path is passed to SDK', async () => {
    process.env.WEBAUTHN_USER_VERIFICATION = 'required';
    const user = await createUser({ email: 'wa-uv@test.com', role: 'host' });
    const regOpts = await webauthnService.registrationOptions({
      userId: user._id,
      email: user.Email,
      host: 'localhost',
      strictRole: true,
    });
    await webauthnService.registerCredential({
      userId: user._id,
      challenge: regOpts.challenge,
      credential: {
        id: 'cred-uv-1',
        rawId: 'cred-uv-1',
        type: 'public-key',
        response: {
          clientDataJSON: 'x',
          attestationObject: 'y',
        },
      },
      strictRole: true,
    });
    expect(mockVerifyReg.mock.calls[0][0].requireUserVerification).toBe(true);
    delete process.env.WEBAUTHN_USER_VERIFICATION;
  });
});
