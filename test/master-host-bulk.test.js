'use strict';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
  getApp,
  agentWithAuth,
  getCsrfPair,
  withCsrf,
  absoluteRange,
  futureRange,
} = require('./helpers');
const Space = require('../models/Space');
const Branch = require('../models/Branch');
const bookingService = require('../services/bookingService');
const Blackout = require('../models/Blackout');

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

describe('Host bulk spaces + blackout notify', () => {
  test('bulk patch price/status/amenities and blackout', async () => {
    const host = await createUser({ email: 'hbulk@test.com', role: 'host' });
    const customer = await createUser({ email: 'cbulk@test.com', role: 'customer' });
    const { space, branch } = await seedHostSpace(host);
    const space2 = await Space.create({
      BranchID: branch._id,
      HostID: host._id,
      SpaceCode: 'R-bulk-2',
      Name: 'Room 02',
      Category: 'desk',
      PricePerHour: 50000,
      DepositAmount: 10000,
      Status: 'available',
    });

    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);

    const bulk = await withCsrf(
      request(app).post('/api/host/spaces/bulk'),
      csrf,
      `authToken=${token}`
    ).send({
      spaceIds: [space._id, space2._id],
      pricePerHour: 120000,
      status: 'maintenance',
      amenities: ['Wifi', 'AC'],
      freeCancelHours: 48,
      instantBook: true,
    });
    expect(bulk.status).toBe(200);
    expect(bulk.body.modified).toBeGreaterThanOrEqual(1);

    const s1 = await Space.findById(space._id);
    expect(s1.PricePerHour).toBe(120000);
    expect(s1.Status).toBe('maintenance');
    expect(s1.Amenities).toContain('Wifi');
    expect(s1.FreeCancelHours).toBe(48);
    expect(s1.InstantBook).toBe(true);

    // booking overlapping for notify
    await Space.updateOne({ _id: space._id }, { $set: { Status: 'available' } });
    const day = new Date();
    day.setDate(day.getDate() + 4);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 10, 0, 12, 0);
    await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const bo = await withCsrf(
      request(app).post('/api/host/blackouts'),
      csrf,
      `authToken=${token}`
    ).send({
      spaceId: space._id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      reason: 'floor wax',
      notifyCustomers: true,
    });
    expect(bo.status).toBe(201);
    expect(bo.body.blackout).toBeTruthy();
    expect(bo.body.notified).toBeGreaterThanOrEqual(1);

    const list = await request(app)
      .get('/api/host/blackouts')
      .set('Cookie', `authToken=${token}`);
    expect(list.status).toBe(200);
    expect(list.body.blackouts.length).toBeGreaterThanOrEqual(1);

    const del = await withCsrf(
      request(app).delete(`/api/host/blackouts/${bo.body.blackout._id}`),
      csrf,
      `authToken=${token}`
    );
    expect(del.status).toBe(200);
    expect(await Blackout.countDocuments({ HostID: host._id })).toBe(0);

    const branchSt = await withCsrf(
      request(app).put(`/api/host/branches/${branch._id}/status`),
      csrf,
      `authToken=${token}`
    ).send({ status: 'maintenance', note: 'renovation' });
    expect(branchSt.status).toBe(200);
    expect((await Branch.findById(branch._id)).Status).toBe('maintenance');
  });
});

describe('Admin listing moderation', () => {
  test('suspend and restore branch; flagged queue', async () => {
    const admin = await createUser({ email: 'abulk@test.com', role: 'admin' });
    const host = await createUser({ email: 'hmod@test.com', role: 'host' });
    const { branch, space } = await seedHostSpace(host);
    const { token } = agentWithAuth(app, admin);
    const csrf = await getCsrfPair(app);

    const sus = await withCsrf(
      request(app).post('/api/admin/listings/moderate'),
      csrf,
      `authToken=${token}`
    ).send({
      targetType: 'branch',
      targetId: branch._id,
      action: 'suspend',
      reason: 'misleading price',
    });
    expect(sus.status).toBe(200);
    expect(sus.body.status).toBe('inactive');
    const b = await Branch.findById(branch._id);
    expect(b.Status).toBe('inactive');
    expect(b.Moderation.LastAction).toBe('suspend');

    const flagged = await request(app)
      .get('/api/admin/listings/flagged')
      .set('Cookie', `authToken=${token}`);
    expect(flagged.status).toBe(200);
    expect(flagged.body.branches.some((x) => String(x._id) === String(branch._id))).toBe(true);

    const rest = await withCsrf(
      request(app).post('/api/admin/listings/moderate'),
      csrf,
      `authToken=${token}`
    ).send({
      targetType: 'space',
      targetId: space._id,
      action: 'request_change',
      note: 'Fix cover image',
    });
    expect(rest.status).toBe(200);
    expect(rest.body.action).toBe('request_change');

    const restore = await withCsrf(
      request(app).post('/api/admin/listings/moderate'),
      csrf,
      `authToken=${token}`
    ).send({
      targetType: 'branch',
      targetId: branch._id,
      action: 'restore',
    });
    expect(restore.status).toBe(200);
    expect((await Branch.findById(branch._id)).Status).toBe('active');
  });

  test('pages render', async () => {
    expect((await request(app).get('/host/ops')).status).toBe(302); // requires host
    expect((await request(app).get('/admin/listings')).status).toBe(302);
  });
});
