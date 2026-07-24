'use strict';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
  getApp,
} = require('./helpers');
const Branch = require('../models/Branch');
const { assertClientDataChallenge } = require('../services/webauthnService');

let app;

beforeAll(async () => {
  await startMemoryMongo();
  app = getApp();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearDb();
});

describe('Featured + image sitemap', () => {
  test('featured API and image sitemap xml', async () => {
    const host = await createUser({ email: 'hfeat@test.com', role: 'host' });
    const { branch } = await seedHostSpace(host);
    await Branch.updateOne(
      { _id: branch._id },
      {
        $set: {
          Images: ['https://img.example/a.jpg', 'https://img.example/b.jpg'],
          CitySlug: 'ho-chi-minh',
          DistrictSlug: 'quan-1',
          Slug: 'feat-branch',
          RatingAvg: 4.8,
        },
      }
    );

    const feat = await request(app).get('/api/featured?limit=5');
    expect(feat.status).toBe(200);
    expect(feat.body.featured.length).toBeGreaterThanOrEqual(1);
    expect(feat.body.newest).toBeDefined();

    const sm = await request(app).get('/sitemap-images.xml');
    expect(sm.status).toBe(200);
    expect(sm.text).toContain('image:image');
    expect(sm.text).toContain('https://img.example/a.jpg');
    expect(sm.text).toContain('feat-branch');

    expect((await request(app).get('/')).status).toBe(200);
  });
});

describe('WebAuthn clientData helper', () => {
  test('assertClientDataChallenge', () => {
    const challenge = 'abc123challenge';
    const payload = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge, origin: 'http://localhost' })
    ).toString('base64url');
    expect(assertClientDataChallenge(payload, challenge)).toBe(true);
    expect(assertClientDataChallenge(payload, 'other')).toBe(false);
  });
});
