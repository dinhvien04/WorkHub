'use strict';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  agentWithAuth,
  getApp,
  getCsrfPair,
  withCsrf,
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
  test('login success sets HttpOnly cookie and does not return token', async () => {
    await createUser({ email: 'a@test.com', password: 'Pass1234', role: 'customer' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@test.com', password: 'Pass1234' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
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

  test('unverified host cannot login', async () => {
    await createUser({
      email: 'h@test.com',
      password: 'Pass1234',
      role: 'host',
      hostVerified: false,
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'h@test.com', password: 'Pass1234' });
    expect(res.status).toBe(403);
  });

  test('banned after login invalidates token', async () => {
    const user = await createUser({ email: 'b@test.com', password: 'Pass1234' });
    const { token } = agentWithAuth(app, user);
    user.Status = 'banned';
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    const res = await request(app).get('/api/auth/me').set('Cookie', `authToken=${token}`);
    expect([401, 403]).toContain(res.status);
  });

  test('logout requires CSRF and clears session', async () => {
    const user = await createUser({ email: 'c@test.com', password: 'Pass1234' });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);

    const noCsrf = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `authToken=${token}`);
    expect(noCsrf.status).toBe(403);

    const logout = await withCsrf(
      request(app).post('/api/auth/logout'),
      csrf,
      `authToken=${token}`
    );
    expect(logout.status).toBe(200);

    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  test('forgot password does not reveal email existence', async () => {
    await createUser({ email: 'exists@test.com', password: 'Pass1234' });
    const r1 = await request(app).post('/api/auth/forgot-password').send({ email: 'exists@test.com' });
    const r2 = await request(app).post('/api/auth/forgot-password').send({ email: 'nope@test.com' });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.message).toBe(r2.body.message);
  });
});
