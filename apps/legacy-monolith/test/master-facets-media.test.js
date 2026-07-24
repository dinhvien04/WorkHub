'use strict';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  agentWithAuth,
  seedHostSpace,
  getApp,
  getCsrfPair,
  withCsrf,
} = require('./helpers');
const Branch = require('../models/Branch');
const Space = require('../models/Space');
const { memoryStore } = require('../utils/rateLimitStore');
const { getSearchFacets } = require('../services/searchService');

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

describe('Search facets', () => {
  test('facets endpoint returns cities amenities price', async () => {
    const host = await createUser({ email: 'hfac@test.com', role: 'host' });
    const { branch, space } = await seedHostSpace(host);
    await Branch.updateOne(
      { _id: branch._id },
      { $set: { City: 'Hồ Chí Minh', CitySlug: 'ho-chi-minh', District: 'Quận 1', DistrictSlug: 'quan-1' } }
    );
    await Space.updateOne(
      { _id: space._id },
      { $set: { Amenities: ['Wi-Fi', 'Máy chiếu'], PricePerHour: 150000 } }
    );

    const res = await request(app).get('/api/search/facets');
    expect(res.status).toBe(200);
    expect(res.body.cities.length).toBeGreaterThanOrEqual(1);
    expect(res.body.price.min).toBeGreaterThan(0);

    const direct = await getSearchFacets();
    expect(direct.amenities.some((a) => a.name === 'Wi-Fi')).toBe(true);
  });
});

describe('Media reorder + conversion metrics + rate store', () => {
  test('reorder images and admin conversion', async () => {
    const store = memoryStore();
    const a = await store.increment('k1');
    expect(a.totalHits).toBe(1);
    const b = await store.increment('k1');
    expect(b.totalHits).toBe(2);
    await store.resetKey('k1');

    const host = await createUser({ email: 'himg@test.com', role: 'host' });
    const { branch } = await seedHostSpace(host);
    branch.Images = [
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
      'https://example.com/c.jpg',
    ];
    await branch.save();

    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);
    const reordered = [
      'https://example.com/c.jpg',
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ];
    const res = await withCsrf(
      request(app).put(`/api/hosts/branches/${branch._id}/images/reorder`),
      csrf,
      `authToken=${token}`
    ).send({ images: reordered });
    expect(res.status).toBe(200);
    expect(res.body.images[0]).toBe('https://example.com/c.jpg');

    const admin = await createUser({ email: 'aconv@test.com', role: 'admin' });
    const { token: aTok } = agentWithAuth(app, admin);
    const metrics = await request(app)
      .get('/api/admin/metrics/conversion?days=30')
      .set('Cookie', `authToken=${aTok}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.funnel).toBeTruthy();
    expect(metrics.body.rates).toBeTruthy();
  });
});

describe('Production CSS utilities file', () => {
  test('utilities.css is served', async () => {
    const res = await request(app).get('/css/utilities.css');
    expect(res.status).toBe(200);
    expect(res.text).toContain('.flex');
  });
});
