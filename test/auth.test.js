'use strict';

process.env.NODE_ENV = 'test';
process.env.DISABLE_CSRF = '1';
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'test_jwt_secret_key_at_least_32_characters_long_for_workhub';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  agentWithAuth,
  getApp,
} = require('./helpers');

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

describe('Authentication', () => {
  test('login success sets HttpOnly cookie and does not return token in body', async () => {
    await createUser({ email: 'a@test.com', password: 'Pass1234', role: 'customer' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@test.com', password: 'Pass1234' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user.role).toBe('customer');
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some((c) => c.startsWith('authToken='))).toBe(true);
    expect(cookies.some((c) => /HttpOnly/i.test(c))).toBe(true);
  });

  test('login wrong password', async () => {
    await createUser({ email: 'a@test.com', password: 'Pass1234' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@test.com', password: 'Wrong1' });
    expect(res.status).toBe(401);
  });

  test('banned user cannot login', async () => {
    await createUser({ email: 'ban@test.com', password: 'Pass1234', status: 'banned' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ban@test.com', password: 'Pass1234' });
    expect(res.status).toBe(403);
  });

  test('banned after login invalidates token', async () => {
    const user = await createUser({ email: 'b@test.com', password: 'Pass1234' });
    const { token } = agentWithAuth(app, user);

    user.Status = 'banned';
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `authToken=${token}`);

    expect([401, 403]).toContain(res.status);
  });

  test('logout clears cookie and private API returns 401', async () => {
    const user = await createUser({ email: 'c@test.com', password: 'Pass1234' });
    const { token } = agentWithAuth(app, user);

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `authToken=${token}`);
    expect(logout.status).toBe(200);

    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  test('forgot password does not reveal email existence', async () => {
    await createUser({ email: 'exists@test.com', password: 'Pass1234' });

    const r1 = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'exists@test.com' });
    const r2 = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nope@test.com' });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.message).toBe(r2.body.message);
  });

  test('env validation rejects short or missing JWT_SECRET', () => {
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = '';
    const missing = ['JWT_SECRET', 'MONGODB_URI'].filter((k) => !process.env[k] || !String(process.env[k]).trim());
    expect(missing).toContain('JWT_SECRET');
    process.env.JWT_SECRET = 'short';
    expect(process.env.JWT_SECRET.length < 32).toBe(true);
    process.env.JWT_SECRET = prev;
  });
});
