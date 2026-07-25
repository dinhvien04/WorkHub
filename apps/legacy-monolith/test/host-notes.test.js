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

describe("Host Notes API", () => {
  test("successfully adds, lists, and caps host notes at 50", async () => {
    const host = await createUser({
      email: "host-notes@test.com",
      role: "host",
    });
    const customer = await createUser({
      email: "cust-notes@test.com",
      role: "customer",
    });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(5, 1);

    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);

    // 1. Success case
    const res1 = await withCsrf(
      request(app).post(`/api/host/bookings/${booking._id}/notes`),
      csrf,
      `authToken=${token}`,
    ).send({ body: "Note 1" });

    expect(res1.status).toBe(201);
    expect(res1.body.notes).toHaveLength(1);
    expect(res1.body.notes[0].Body).toBe("Note 1");
    expect(res1.body.notes[0].AuthorID).toBe(host._id.toString());

    // 2. Empty note case
    const resEmpty = await withCsrf(
      request(app).post(`/api/host/bookings/${booking._id}/notes`),
      csrf,
      `authToken=${token}`,
    ).send({ body: "   " });

    expect(resEmpty.status).toBe(400);

    // 3. Unauthorized host access case
    const otherHost = await createUser({
      email: "other-host-notes@test.com",
      role: "host",
    });
    const { token: otherToken } = agentWithAuth(app, otherHost);

    const resOther = await withCsrf(
      request(app).post(`/api/host/bookings/${booking._id}/notes`),
      csrf,
      `authToken=${otherToken}`,
    ).send({ body: "Note from other host" });

    expect(resOther.status).toBe(404);

    // 4. List notes case
    const listRes = await request(app)
      .get(`/api/host/bookings/${booking._id}/notes`)
      .set("Cookie", `authToken=${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.notes).toHaveLength(1);
    expect(listRes.body.notes[0].Body).toBe("Note 1");

    // 5. Test notes capping at 50 notes
    // We already inserted 'Note 1' (which makes 1 note)
    // Let's add 54 more notes (making a total of 55 notes added).
    // The list should cap at 50, containing 'Note 6' to 'Note 55'.
    for (let i = 2; i <= 55; i++) {
      const resLoop = await withCsrf(
        request(app).post(`/api/host/bookings/${booking._id}/notes`),
        csrf,
        `authToken=${token}`,
      ).send({ body: `Note ${i}` });
      expect(resLoop.status).toBe(201);
    }

    // Now read the notes list again
    const finalRes = await request(app)
      .get(`/api/host/bookings/${booking._id}/notes`)
      .set("Cookie", `authToken=${token}`);

    expect(finalRes.status).toBe(200);
    expect(finalRes.body.notes).toHaveLength(50);
    // The oldest notes (Note 1 to Note 5) should be sliced off
    expect(finalRes.body.notes[0].Body).toBe("Note 6");
    expect(finalRes.body.notes[49].Body).toBe("Note 55");
  });
});
