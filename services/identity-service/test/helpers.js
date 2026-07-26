"use strict";

const request = require("supertest");
const User = require("../models/User");
const { hashPassword } = require("../utils/password");

const ORIGIN = "http://localhost:3000";

function cookieValue(setCookieHeader, name) {
  const list = [].concat(setCookieHeader || []);
  for (const raw of list) {
    const [pair] = String(raw).split(";");
    const eq = pair.indexOf("=");
    if (eq > 0 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1);
  }
  return null;
}

async function createUser(overrides = {}) {
  return User.create({
    Email: "user@example.com",
    PasswordHash: await hashPassword("password12345"),
    FullName: "Test User",
    Role: "customer",
    Status: "active",
    EmailVerified: true,
    AuthProvider: "local",
    tokenVersion: 0,
    ...overrides,
  });
}

/**
 * Log in and collect everything a browser would hold: the auth cookie, a CSRF
 * cookie, and the matching CSRF header value.
 */
async function login(app, { email, password }) {
  const res = await request(app)
    .post("/api/auth/login")
    .set("Origin", ORIGIN)
    .send({ email, password });

  const authCookies = [].concat(res.headers["set-cookie"] || []);
  const authToken = cookieValue(authCookies, "authToken");

  if (!authToken) return { res, cookies: [], csrfToken: null };

  const csrfRes = await request(app)
    .get("/api/auth/csrf")
    .set("Cookie", `authToken=${authToken}`);

  const csrfToken =
    csrfRes.body.csrfToken || cookieValue(csrfRes.headers["set-cookie"], "csrfToken");

  return {
    res,
    authToken,
    csrfToken,
    cookies: [`authToken=${authToken}`, `csrfToken=${csrfToken}`],
  };
}

/**
 * A mutation shaped the way the browser sends it: session cookie, CSRF cookie,
 * matching header, and a same-origin Origin.
 */
function mutate(app, method, path, session) {
  const req = request(app)[method](path).set("Origin", ORIGIN);
  if (session?.cookies?.length) req.set("Cookie", session.cookies.join("; "));
  if (session?.csrfToken) req.set("X-CSRF-Token", session.csrfToken);
  return req;
}

module.exports = { ORIGIN, cookieValue, createUser, login, mutate };
