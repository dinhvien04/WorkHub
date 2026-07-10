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
  futureRange,
} = require('./helpers');
const HostProfile = require('../models/Host_Profile');
const Branch = require('../models/Branch');
const bookingService = require('../services/bookingService');
const messagingService = require('../services/messagingService');
const {
  setVerificationStatus,
  mintDocumentAccessToken,
  verifyDocumentAccessToken,
} = require('../services/hostVerificationService');

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

describe('Host verification states', () => {
  test('approve / needs_info / suspend + document token', async () => {
    const admin = await createUser({ email: 'aver@test.com', role: 'admin' });
    const host = await createUser({
      email: 'hver@test.com',
      role: 'host',
      hostVerified: false,
    });
    const profile = await HostProfile.findOne({ UserID: host._id });
    expect(profile.IsVerified).toBe(false);

    const adminTok = agentWithAuth(app, admin).token;
    const csrf = await getCsrfPair(app);

    const needs = await withCsrf(
      request(app).patch(`/api/admin/hosts/${profile._id}/verification`),
      csrf,
      `authToken=${adminTok}`
    ).send({ status: 'needs_info', reason: 'Thiếu GPĐKKD rõ' });
    expect(needs.status).toBe(200);
    expect(needs.body.status).toBe('needs_info');

    const appr = await withCsrf(
      request(app).patch(`/api/admin/hosts/${profile._id}/verification`),
      csrf,
      `authToken=${adminTok}`
    ).send({ status: 'approved', note: 'OK' });
    expect(appr.status).toBe(200);
    expect(appr.body.isVerified).toBe(true);

    const fresh = await HostProfile.findById(profile._id);
    expect(fresh.VerificationStatus).toBe('approved');
    expect(fresh.IsVerified).toBe(true);

    const mint = await withCsrf(
      request(app).post(`/api/admin/hosts/${profile._id}/document-access`),
      csrf,
      `authToken=${adminTok}`
    ).send({ ttlMinutes: 10 });
    expect(mint.status).toBe(200);
    expect(mint.body.accessToken).toBeTruthy();
    const payload = verifyDocumentAccessToken(mint.body.accessToken);
    expect(payload.hp).toBe(String(profile._id));

    const redeem = await request(app)
      .get(`/api/admin/hosts/${profile._id}/document`)
      .query({ token: mint.body.accessToken })
      .set('Cookie', `authToken=${adminTok}`);
    expect(redeem.status).toBe(200);

    const sus = await withCsrf(
      request(app).patch(`/api/admin/hosts/${profile._id}/verification`),
      csrf,
      `authToken=${adminTok}`
    ).send({ status: 'suspended', reason: 'fraud review' });
    expect(sus.status).toBe(200);
    expect(sus.body.isVerified).toBe(false);
  });
});

describe('Branch publish status', () => {
  test('host can draft/publish branch', async () => {
    const host = await createUser({ email: 'hpub2@test.com', role: 'host' });
    const { branch } = await seedHostSpace(host);
    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);

    const draft = await withCsrf(
      request(app).put(`/api/host/branches/${branch._id}/publish`),
      csrf,
      `authToken=${token}`
    ).send({ publishStatus: 'draft' });
    expect(draft.status).toBe(200);
    expect(draft.body.branch.PublishStatus).toBe('draft');

    const pub = await withCsrf(
      request(app).put(`/api/host/branches/${branch._id}/publish`),
      csrf,
      `authToken=${token}`
    ).send({ publishStatus: 'published' });
    expect(pub.status).toBe(200);
    expect(pub.body.branch.PublishStatus).toBe('published');
  });
});

describe('Messaging PII + report', () => {
  test('redact email/phone and report message', async () => {
    const host = await createUser({ email: 'hmsg@test.com', role: 'host' });
    const customer = await createUser({ email: 'cmsg@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(3, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const sent = await messagingService.sendMessage(
      booking._id,
      customer._id,
      'customer',
      'Gọi mình 0912345678 hoặc mail@example.com nhé'
    );
    expect(sent.body).toContain('[sđt ẩn]');
    expect(sent.body).toContain('[email ẩn]');
    expect(sent.body).not.toMatch(/0912345678/);

    const list = await messagingService.listMessages(booking._id, host._id, 'host');
    expect(list.messages[0].body).toMatch(/ẩn/);

    const rep = await messagingService.reportMessage({
      bookingId: booking._id,
      userId: host._id,
      role: 'host',
      messageId: sent._id,
      reason: 'spam',
    });
    expect(rep.reported).toBe(true);

    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);
    const api = await withCsrf(
      request(app).post(
        `/api/me/bookings/${booking._id}/messages/${sent._id}/report`
      ),
      csrf,
      `authToken=${token}`
    ).send({ reason: 'abuse' });
    expect(api.status).toBe(200);
  });
});
