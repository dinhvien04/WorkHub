'use strict';

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let appInstance;

async function startMemoryMongo() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection.getClient().s?.url || process.env.MONGODB_URI;
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
    // Require only after env + mongo are ready
    const { createApp } = require('../app');
    appInstance = createApp();
  }
  return appInstance;
}

async function createUser({
  email,
  password = 'Pass1234',
  role = 'customer',
  fullName = 'Test User',
  status = 'active',
  tokenVersion = 0,
}) {
  const User = require('../models/User');
  const CustomerProfile = require('../models/Customer_Profile');
  const HostProfile = require('../models/Host_Profile');

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    Email: email,
    PasswordHash: hash,
    FullName: fullName,
    Role: role,
    Status: status,
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
      IsVerified: true,
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
    SpaceCode: `R-${Date.now().toString(36)}`,
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
  const start = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  const end = new Date(start.getTime() + durationHours * 3600 * 1000);
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
  getApp,
};
