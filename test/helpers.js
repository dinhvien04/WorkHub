'use strict';

const bcrypt = require('bcryptjs');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let appInstance;

async function startMemoryMongo() {
  if (mongoose.connection.readyState === 1) {
    return process.env.MONGODB_URI;
  }
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri);
  return uri;
}

async function stopMemoryMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
  appInstance = null;
}

async function clearDb() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

function getApp() {
  if (!appInstance) {
    const { createApp } = require('../app');
    appInstance = createApp();
  }
  return appInstance;
}

/**
 * Fetch CSRF cookie + header value for state-changing requests.
 */
async function getCsrfPair(app) {
  const res = await request(app).get('/api/auth/csrf');
  const csrfToken = res.body.csrfToken;
  // Prefer single csrf cookie matching body (last Set-Cookie wins in browsers)
  const setCookie = res.headers['set-cookie'] || [];
  let cookieVal = csrfToken;
  let preSession = '';
  for (const c of setCookie) {
    const m = c.match(/^csrfToken=([^;]+)/);
    if (m) cookieVal = decodeURIComponent(m[1]);
    const p = c.match(/^csrfPreSession=([^;]+)/);
    if (p) preSession = decodeURIComponent(p[1]);
  }
  // Session-bound CSRF also needs csrfPreSession for anonymous binding
  const parts = [`csrfToken=${cookieVal}`];
  if (preSession) parts.push(`csrfPreSession=${preSession}`);
  const cookieHeader = parts.join('; ');
  return { cookieHeader, csrfToken: cookieVal, preSession };
}

/**
 * Attach CSRF cookie + header. Pass authCookie like `authToken=...`.
 */
function withCsrf(req, csrf, authCookie = '') {
  const parts = [];
  if (authCookie) parts.push(authCookie.includes('=') ? authCookie : `authToken=${authCookie}`);
  if (csrf.cookieHeader) parts.push(csrf.cookieHeader);
  return req.set('Cookie', parts.join('; ')).set('X-CSRF-Token', csrf.csrfToken);
}

async function createUser({
  email,
  password = 'Pass1234',
  role = 'customer',
  fullName = 'Test User',
  status,
  tokenVersion = 0,
  hostVerified = true,
}) {
  const User = require('../models/User');
  const CustomerProfile = require('../models/Customer_Profile');
  const HostProfile = require('../models/Host_Profile');

  const resolvedStatus =
    status !== undefined
      ? status
      : role === 'host'
        ? hostVerified
          ? 'active'
          : 'inactive'
        : 'active';

  const hash = await bcrypt.hash(password, 10);
  // Test helpers create verified/active users by default so existing suites work
  const user = await User.create({
    Email: email,
    PasswordHash: hash,
    FullName: fullName,
    Role: role,
    Status: resolvedStatus,
    EmailVerified: true,
    EmailVerifiedAt: new Date(),
    AuthProvider: 'local',
    tokenVersion,
  });

  if (role === 'customer') {
    await CustomerProfile.create({
      UserID: user._id,
      Phone: '0900000000',
      Avatar: '',
    });
  } else if (role === 'host') {
    await HostProfile.create({
      UserID: user._id,
      CompanyName: 'Host Co',
      TaxCode: `TAX-${user._id.toString().slice(-8)}`,
      Hotline: '0900000001',
      BankName: 'VCB',
      BankNumber: '123456',
      IsVerified: hostVerified,
      VerificationDocument: 'doc.pdf',
    });
  }
  return user;
}

function agentWithAuth(app, user) {
  const { signToken } = require('../controllers/authController');
  const token = signToken(user);
  return { token };
}

async function seedHostSpace(hostUser) {
  const Branch = require('../models/Branch');
  const Space = require('../models/Space');
  const branch = await Branch.create({
    HostID: hostUser._id,
    Name: 'Branch A',
    Address: '1 Test St',
    OpeningTime: '08:00',
    ClosingTime: '22:00',
    Status: 'active',
    Images: ['https://res.cloudinary.com/demo/image/upload/v1/coworking/branchs/test.jpg'],
  });
  const space = await Space.create({
    BranchID: branch._id,
    HostID: hostUser._id,
    SpaceCode: `R-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    Name: 'Room 01',
    Category: 'meeting_room',
    PricePerHour: 100000,
    DepositAmount: 30000,
    Status: 'available',
    Images: ['https://res.cloudinary.com/demo/image/upload/v1/coworking/spaces/room.jpg'],
  });
  return { branch, space };
}

function futureRange(hoursFromNow = 2, durationHours = 2) {
  // Align to 30-min slots for cleaner tests
  const step = 30 * 60 * 1000;
  let start = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  start = new Date(Math.ceil(start.getTime() / step) * step);
  const end = new Date(start.getTime() + durationHours * 3600 * 1000);
  return { start, end };
}

/** Absolute range on a fixed day for overlap tests */
function absoluteRange(baseDate, startH, startM, endH, endM) {
  const start = new Date(baseDate);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(baseDate);
  end.setHours(endH, endM, 0, 0);
  return { start, end };
}

module.exports = {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  agentWithAuth,
  seedHostSpace,
  futureRange,
  absoluteRange,
  getApp,
  getCsrfPair,
  withCsrf,
};
