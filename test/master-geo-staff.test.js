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
const StaffMember = require('../models/StaffMember');
const { haversineKm, buildZeroResultSuggestions } = require('../services/searchService');
const featureFlagService = require('../services/featureFlagService');
const User = require('../models/User');

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

describe('Geo search + zero result', () => {
  test('near sort and distance', async () => {
    const host = await createUser({ email: 'hgeo@test.com', role: 'host' });
    await seedHostSpace(host);
    // Update branch coords: HCM approx
    const branch = await Branch.findOne({ HostID: host._id });
    branch.Latitude = 10.7769;
    branch.Longitude = 106.7009;
    branch.Location = { type: 'Point', coordinates: [106.7009, 10.7769] };
    await branch.save();

    const d = haversineKm(10.78, 106.7, 10.7769, 106.7009);
    expect(d).toBeLessThan(5);

    const res = await request(app).get(
      '/api/search?lat=10.78&lng=106.70&sort=near&radiusKm=50'
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    if (res.body.items.length) {
      expect(res.body.items[0].distanceKm).toBeDefined();
    }

    const empty = await request(app).get(
      '/api/search?location=zzzznoresult999&city=no-city-xyz'
    );
    expect(empty.status).toBe(200);
    expect(empty.body.items.length).toBe(0);
    expect(empty.body.zeroResult).toBeTruthy();
    expect(empty.body.zeroResult.tips.length).toBeGreaterThan(0);

    const z = await buildZeroResultSuggestions({ city: 'ho-chi-minh' });
    expect(z.suggestedActions).toBeTruthy();
  });
});

describe('Staff memberships + permissions + admin 2fa flag', () => {
  test('staff me and permissions', async () => {
    const host = await createUser({ email: 'hstaff@test.com', role: 'host' });
    const staffUser = await createUser({ email: 'suser@test.com', role: 'customer' });
    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: staffUser._id,
      Role: 'receptionist',
      Status: 'active',
    });

    const { token } = agentWithAuth(app, staffUser);
    const mem = await request(app)
      .get('/api/staff/me')
      .set('Cookie', `authToken=${token}`);
    expect(mem.status).toBe(200);
    expect(mem.body.memberships.length).toBe(1);

    const perms = await request(app)
      .get('/api/host/me/permissions')
      .set('Cookie', `authToken=${token}`)
      .set('X-Host-Owner-Id', String(host._id));
    expect(perms.status).toBe(200);
    expect(perms.body.staffRole).toBe('receptionist');
    expect(perms.body.canFinance).toBe(false);

    // Staff inbox with reception:view
    const inbox = await request(app)
      .get('/api/staff/host/inbox?bucket=today')
      .set('Cookie', `authToken=${token}`)
      .set('X-Host-Owner-Id', String(host._id));
    expect(inbox.status).toBe(200);

    // Admin 2FA gate
    await featureFlagService.upsertFlag({
      key: 'admin_require_2fa',
      enabled: true,
      percentage: 100,
    });
    const admin = await createUser({ email: 'a2fa@test.com', role: 'admin' });
    await User.updateOne({ _id: admin._id }, { $set: { TotpEnabled: false } });
    const { token: aTok } = agentWithAuth(app, admin);
    const blocked = await request(app)
      .get('/api/admin/users')
      .set('Cookie', `authToken=${aTok}`);
    expect(blocked.status).toBe(403);

    await User.updateOne({ _id: admin._id }, { $set: { TotpEnabled: true } });
    const ok = await request(app)
      .get('/api/admin/users')
      .set('Cookie', `authToken=${aTok}`);
    expect(ok.status).toBe(200);

    // disable flag for other tests
    await featureFlagService.upsertFlag({ key: 'admin_require_2fa', enabled: false });
  });
});

describe('SBOM script', () => {
  test('generate sbom file', () => {
    const { execSync } = require('child_process');
    const fs = require('fs');
    execSync('node scripts/generate-sbom.js', { cwd: process.cwd() });
    expect(fs.existsSync('docs/sbom.json')).toBe(true);
    const sbom = JSON.parse(fs.readFileSync('docs/sbom.json', 'utf8'));
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.components.length).toBeGreaterThan(10);
  });
});
