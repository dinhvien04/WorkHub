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
const StaffMember = require('../models/StaffMember');
const User = require('../models/User');

let app;

beforeAll(async () => {
  process.env.ALLOW_GOOGLE_MOCK = '1';
  await startMemoryMongo();
  app = getApp();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearDb();
});

describe('Google OIDC mock', () => {
  test('status + mock login creates user', async () => {
    const st = await request(app).get('/api/auth/google/status');
    expect(st.status).toBe(200);
    expect(st.body.mockAllowed).toBe(true);

    const login = await request(app)
      .post('/api/auth/google/mock')
      .send({ email: 'guser@example.com', name: 'G User' });
    expect(login.status).toBe(200);
    expect(login.body.user).toBeTruthy();
    expect(login.headers['set-cookie']?.some((c) => c.startsWith('authToken='))).toBe(true);

    const u = await User.findOne({ Email: 'guser@example.com' });
    expect(u.AuthProvider).toBe('google');
    expect(u.GoogleSub).toBeTruthy();
    expect(u.EmailVerified).toBe(true);

    // second login links same user
    const again = await request(app)
      .post('/api/auth/google/mock')
      .send({ email: 'guser@example.com', name: 'G User' });
    expect(again.status).toBe(200);
    const count = await User.countDocuments({ Email: 'guser@example.com' });
    expect(count).toBe(1);
  });

  test('email collision cannot silently take over local account', async () => {
    await createUser({ email: 'local@example.com', role: 'customer', password: 'Pass1234' });
    const login = await request(app)
      .post('/api/auth/google/mock')
      .send({ email: 'local@example.com', name: 'Local Linked' });
    // Must require explicit linking — no silent GoogleSub attach
    expect([409, 400, 403]).toContain(login.status);
    const u = await User.findOne({ Email: 'local@example.com' });
    expect(u.GoogleSub).toBeFalsy();
  });
});

describe('Staff calendar proxy', () => {
  test('manager can view calendar via staff path', async () => {
    const host = await createUser({ email: 'hcal@test.com', role: 'host' });
    const mgr = await createUser({ email: 'mcal@test.com', role: 'customer' });
    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: mgr._id,
      Role: 'manager',
      AllBranches: true,
      Status: 'active',
    });
    await seedHostSpace(host);
    const { token } = agentWithAuth(app, mgr);
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 86400000).toISOString();
    const cal = await request(app)
      .get(`/api/staff/host/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Cookie', `authToken=${token}`)
      .set('X-Host-Owner-Id', String(host._id));
    expect(cal.status).toBe(200);
    expect(cal.body.events).toBeDefined();
  });
});
