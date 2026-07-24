"use strict";

const request = require("supertest");
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  agentWithAuth,
  seedHostSpace,
  futureRange,
  getApp,
  getCsrfPair,
  withCsrf,
} = require("./helpers");
const bookingService = require("../services/bookingService");
const StaffMember = require("../models/StaffMember");
const Incident = require("../models/Incident");
const Space = require("../models/Space");
const Branch = require("../models/Branch");

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

describe("Incidents API", () => {
  test("Host owner can successfully create an incident", async () => {
    const host = await createUser({
      email: "host-incident@test.com",
      role: "host",
    });
    const customer = await createUser({
      email: "cust-incident@test.com",
      role: "customer",
    });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(2, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);

    const res = await withCsrf(
      request(app).post("/api/host/incidents"),
      csrf,
      `authToken=${token}`,
    ).send({
      bookingId: booking._id.toString(),
      type: "damage",
      description: "Broken table leg",
    });

    expect(res.status).toBe(201);
    expect(res.body.incident).toBeDefined();
    expect(res.body.incident.Type).toBe("damage");
    expect(res.body.incident.Description).toBe("Broken table leg");
    expect(res.body.incident.HostID).toBe(host._id.toString());
    expect(res.body.incident.ReportedBy).toBe(host._id.toString());

    // Verify it is saved in DB
    const dbIncident = await Incident.findById(res.body.incident._id);
    expect(dbIncident).toBeDefined();
    expect(dbIncident.Type).toBe("damage");
  });

  test("Input validation for type and description", async () => {
    const host = await createUser({
      email: "host-validation@test.com",
      role: "host",
    });
    const customer = await createUser({
      email: "cust-validation@test.com",
      role: "customer",
    });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(2, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);

    // Invalid type
    const resInvalidType = await withCsrf(
      request(app).post("/api/host/incidents"),
      csrf,
      `authToken=${token}`,
    ).send({
      bookingId: booking._id.toString(),
      type: "invalid_type",
      description: "Some description",
    });
    expect(resInvalidType.status).toBe(400);

    // Empty description
    const resEmptyDesc = await withCsrf(
      request(app).post("/api/host/incidents"),
      csrf,
      `authToken=${token}`,
    ).send({
      bookingId: booking._id.toString(),
      type: "damage",
      description: "   ",
    });
    expect(resEmptyDesc.status).toBe(400);

    // Description too long (>= 3000 chars)
    const longDesc = "a".repeat(3000);
    const resLongDesc = await withCsrf(
      request(app).post("/api/host/incidents"),
      csrf,
      `authToken=${token}`,
    ).send({
      bookingId: booking._id.toString(),
      type: "damage",
      description: longDesc,
    });
    expect(resLongDesc.status).toBe(400);
  });

  test("Staff permission check: manager can create, receptionist is denied", async () => {
    const host = await createUser({
      email: "host-staff@test.com",
      role: "host",
    });
    const managerUser = await createUser({
      email: "manager@test.com",
      role: "customer",
    });
    const receptionistUser = await createUser({
      email: "receptionist@test.com",
      role: "customer",
    });
    const customer = await createUser({
      email: "cust-staff@test.com",
      role: "customer",
    });

    // Create staff member profiles
    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: managerUser._id,
      Role: "manager",
      AllBranches: true,
      Status: "active",
    });

    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: receptionistUser._id,
      Role: "receptionist",
      AllBranches: true,
      Status: "active",
    });

    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(2, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const csrf = await getCsrfPair(app);

    // 1. Manager attempts creation (should succeed)
    const { token: managerToken } = agentWithAuth(app, managerUser);
    const resManager = await withCsrf(
      request(app).post("/api/host/incidents"),
      csrf,
      `authToken=${managerToken}`,
    )
      .set("X-Host-Owner-Id", String(host._id))
      .send({
        bookingId: booking._id.toString(),
        type: "damage",
        description: "Broken chair",
      });

    expect(resManager.status).toBe(201);
    expect(resManager.body.incident.HostID).toBe(host._id.toString());
    expect(resManager.body.incident.ReportedBy).toBe(
      managerUser._id.toString(),
    );

    // 2. Receptionist attempts creation (should be forbidden: 403)
    const { token: receptionistToken } = agentWithAuth(app, receptionistUser);
    const resReceptionist = await withCsrf(
      request(app).post("/api/host/incidents"),
      csrf,
      `authToken=${receptionistToken}`,
    )
      .set("X-Host-Owner-Id", String(host._id))
      .send({
        bookingId: booking._id.toString(),
        type: "damage",
        description: "Broken window",
      });

    expect(resReceptionist.status).toBe(403);
  });

  test("Branch restrictions: staff restricted to branch A cannot create incident for branch B booking", async () => {
    const host = await createUser({
      email: "host-branch@test.com",
      role: "host",
    });
    const managerUser = await createUser({
      email: "mgr-branch@test.com",
      role: "customer",
    });
    const customer = await createUser({
      email: "cust-branch@test.com",
      role: "customer",
    });

    // Seed Branch A + Space A
    const { branch: branchA, space: spaceA } = await seedHostSpace(host);

    // Seed Branch B + Space B manually
    const branchB = await Branch.create({
      HostID: host._id,
      Name: "Branch B",
      Address: "2 Test St",
      OpeningTime: "08:00",
      ClosingTime: "22:00",
      Status: "active",
      Images: [
        "https://res.cloudinary.com/demo/image/upload/v1/coworking/branchs/test.jpg",
      ],
    });
    const spaceB = await Space.create({
      BranchID: branchB._id,
      HostID: host._id,
      SpaceCode: `R-${Date.now().toString(36)}-B`,
      Name: "Room B",
      Category: "meeting_room",
      PricePerHour: 100000,
      DepositAmount: 30000,
      Status: "available",
      Images: [
        "https://res.cloudinary.com/demo/image/upload/v1/coworking/spaces/room.jpg",
      ],
    });

    // Create staff member who only has access to Branch A
    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: managerUser._id,
      Role: "manager",
      AllBranches: false,
      BranchIDs: [branchA._id],
      Status: "active",
    });

    const { start, end } = futureRange(2, 1);

    // Booking in Branch A (allowed)
    const bookingA = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: spaceA._id,
      startTime: start,
      endTime: end,
    });

    // Booking in Branch B (disallowed)
    const bookingB = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: spaceB._id,
      startTime: start,
      endTime: end,
    });

    const { token } = agentWithAuth(app, managerUser);
    const csrf = await getCsrfPair(app);

    // 1. Create incident for Booking A (should succeed)
    const resA = await withCsrf(
      request(app).post("/api/host/incidents"),
      csrf,
      `authToken=${token}`,
    )
      .set("X-Host-Owner-Id", String(host._id))
      .send({
        bookingId: bookingA._id.toString(),
        type: "damage",
        description: "Broken table in branch A",
      });
    expect(resA.status).toBe(201);

    // 2. Create incident for Booking B (should be forbidden: 403)
    const resB = await withCsrf(
      request(app).post("/api/host/incidents"),
      csrf,
      `authToken=${token}`,
    )
      .set("X-Host-Owner-Id", String(host._id))
      .send({
        bookingId: bookingB._id.toString(),
        type: "damage",
        description: "Broken table in branch B",
      });
    expect(resB.status).toBe(403);
  });
});
