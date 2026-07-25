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
} = require('./helpers');
const Branch = require('../models/Branch');
const GroupInvite = require('../models/GroupInvite');
const { previewSeries } = require('../services/recurringService');

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

describe('Recurring preview + series', () => {
  test('preview and create weekly series', async () => {
    const host = await createUser({ email: 'hrec@test.com', role: 'host' });
    const customer = await createUser({ email: 'crec@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);

    const start = new Date();
    start.setDate(start.getDate() + 3);
    start.setHours(0, 0, 0, 0);

    const preview = await previewSeries({
      spaceId: space._id,
      frequency: 'weekly',
      daysOfWeek: [start.getDay()],
      startTimeOfDay: '10:00',
      durationMinutes: 60,
      seriesStart: start.toISOString(),
      occurrenceCount: 3,
    });
    expect(preview.occurrenceCount).toBeGreaterThanOrEqual(1);
    expect(preview.occurrences[0].startTime).toBeTruthy();

    const { token } = agentWithAuth(app, customer);
    const authCookie = `authToken=${token}`;
    const csrf = await getCsrfPair(app, authCookie);
    const prevApi = await withCsrf(
      request(app).post('/api/bookings/recurring/preview'),
      csrf,
      authCookie
    ).send({
      spaceId: space._id,
      frequency: 'weekly',
      daysOfWeek: [start.getDay()],
      startTimeOfDay: '10:00',
      durationMinutes: 60,
      seriesStart: start.toISOString().slice(0, 10),
      occurrenceCount: 2,
    });
    expect(prevApi.status).toBe(200);
    expect(prevApi.body.preview.occurrences.length).toBeGreaterThanOrEqual(1);

    const create = await withCsrf(
      request(app).post('/api/bookings/recurring'),
      csrf,
      authCookie
    )
      .set('Idempotency-Key', `recurring-api-${customer._id}-${Date.now()}`)
      .send({
        spaceId: space._id,
        frequency: 'weekly',
        daysOfWeek: [start.getDay()],
        startTimeOfDay: '10:00',
        durationMinutes: 60,
        seriesStart: start.toISOString(),
        occurrenceCount: 2,
      });
    expect(create.status).toBe(201);
    expect(create.body.createdCount).toBeGreaterThanOrEqual(1);

    const list = await request(app)
      .get('/api/bookings/recurring')
      .set('Cookie', `authToken=${token}`);
    expect(list.status).toBe(200);
    expect(list.body.series.length).toBeGreaterThanOrEqual(1);

    const seriesId = list.body.series[0]._id;
    const cancel = await withCsrf(
      request(app).put(`/api/bookings/recurring/${seriesId}/cancel`),
      csrf,
      `authToken=${token}`
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.series.Status).toBe('cancelled');
  });
});

describe('Group booking + RSVP', () => {
  test('create invites and public RSVP', async () => {
    const host = await createUser({ email: 'hgrp@test.com', role: 'host' });
    const customer = await createUser({ email: 'cgrp@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const day = new Date();
    day.setDate(day.getDate() + 5);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 13, 0, 15, 0);

    const { token } = agentWithAuth(app, customer);
    const csrf = await getCsrfPair(app);
    const res = await withCsrf(
      request(app).post('/api/bookings/group'),
      csrf,
      `authToken=${token}`
    ).send({
      spaceId: space._id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      corporateName: 'Acme',
      attendees: [
        { email: 'a@example.com', name: 'An' },
        { email: 'b@example.com', name: 'Binh' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.group.attendeeCount).toBe(2);
    expect(res.body.invites.length).toBe(2);
    const invToken = res.body.invites[0].token;
    expect(invToken).toBeTruthy();

    const pub = await request(app).get(`/api/rsvp/${invToken}`);
    expect(pub.status).toBe(200);
    expect(pub.body.booking.startTime).toBeTruthy();

    const rsvp = await withCsrf(request(app).post(`/api/rsvp/${invToken}`), csrf).send({
      status: 'accepted',
    });
    expect(rsvp.status).toBe(200);
    expect(rsvp.body.invite.rsvpStatus).toBe('accepted');

    const bookingId = res.body.booking._id;
    const list = await request(app)
      .get(`/api/bookings/${bookingId}/group-invites`)
      .set('Cookie', `authToken=${token}`);
    expect(list.status).toBe(200);
    expect(list.body.invites.some((i) => i.rsvpStatus === 'accepted')).toBe(true);
    // tokens not leaked on list
    expect(JSON.stringify(list.body)).not.toMatch(/token/i);
  });
});

describe('City listing SEO + pages', () => {
  test('city page has ItemList, districts, pages render', async () => {
    const host = await createUser({ email: 'hcity@test.com', role: 'host' });
    const { branch } = await seedHostSpace(host);
    await Branch.updateOne(
      { _id: branch._id },
      {
        $set: {
          City: 'Hồ Chí Minh',
          District: 'Quận 1',
          CitySlug: 'ho-chi-minh',
          DistrictSlug: 'quan-1',
          Slug: 'city-branch',
          RatingAvg: 4.5,
        },
      }
    );

    const city = await request(app).get('/khong-gian/ho-chi-minh');
    expect(city.status).toBe(200);
    expect(city.text).toContain('ItemList');
    expect(city.text).toContain('quan-1');
    expect(city.text).toContain('Đặt lặp lại');

    expect((await request(app).get('/booking/recurring')).status).toBe(200);
    expect((await request(app).get('/booking/group')).status).toBe(200);
    expect((await request(app).get('/rsvp/demo-token')).status).toBe(200);
  });
});
