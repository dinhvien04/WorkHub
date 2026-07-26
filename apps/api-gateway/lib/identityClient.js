"use strict";

/**
 * The gateway's only route to identity state.
 *
 * Two layers:
 *   - JWKS: verify an RS256 signature locally, so the common case costs no
 *     network round trip.
 *   - Introspection: ask identity-service whether the token is still live
 *     (user status, tokenVersion, session revocation). A signature alone
 *     cannot answer that.
 *
 * The gateway holds no database connection. Identity owns the identity
 * database; a second writer to those collections is exactly the coupling the
 * service split was meant to remove.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { TokenCache } = require("./tokenCache");

const JWKS_PATH = "/.well-known/jwks.json";
const JWKS_TTL_MS = 5 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 10 * 1000;

class IdentityClient {
  constructor({
    baseUrl,
    internalSecret,
    serviceName = "api-gateway",
    cache,
    fetchImpl,
    timeoutMs = 5000,
  }) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.internalSecret = internalSecret;
    this.serviceName = serviceName;
    this.cache = cache || new TokenCache();
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.timeoutMs = timeoutMs;

    this.jwks = { keys: new Map(), fetchedAt: 0, etag: null };
    this.lastJwksAttempt = 0;
    this.jwksInFlight = null;
  }

  async request(path, options = {}) {
    const controller = new globalThis.AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Refresh the JWKS, honouring ETag so an unchanged key set costs a 304.
   */
  async refreshJwks({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - this.jwks.fetchedAt < JWKS_TTL_MS && this.jwks.keys.size > 0) {
      return this.jwks;
    }
    // Do not let a burst of unknown-kid tokens turn into a fetch storm.
    if (now - this.lastJwksAttempt < JWKS_MIN_REFETCH_MS && this.jwks.keys.size > 0) {
      return this.jwks;
    }
    if (this.jwksInFlight) return this.jwksInFlight;

    this.lastJwksAttempt = now;
    this.jwksInFlight = (async () => {
      try {
        const headers = {};
        if (this.jwks.etag) headers["If-None-Match"] = this.jwks.etag;

        const res = await this.request(JWKS_PATH, { headers });
        if (res.status === 304) {
          this.jwks.fetchedAt = Date.now();
          return this.jwks;
        }
        if (!res.ok) throw new Error(`JWKS fetch returned ${res.status}`);

        const body = await res.json();
        const keys = new Map();
        for (const jwk of body.keys || []) {
          if (jwk.kty !== "RSA" || !jwk.kid) continue;
          keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
        }

        this.jwks = { keys, fetchedAt: Date.now(), etag: res.headers.get("etag") };
        return this.jwks;
      } catch (err) {
        console.error(`[Gateway] JWKS refresh failed: ${err.message}`);
        return this.jwks;
      } finally {
        this.jwksInFlight = null;
      }
    })();

    return this.jwksInFlight;
  }

  async getVerificationKey(kid) {
    if (!kid) return null;
    if (this.jwks.keys.has(kid)) return this.jwks.keys.get(kid);

    // Unknown kid usually means a rotation just happened.
    await this.refreshJwks({ force: true });
    return this.jwks.keys.get(kid) || null;
  }

  /**
   * Verify an RS256 access token's signature and claims locally.
   * Returns null when the token is not an identity-issued RS256 token.
   */
  async verifyLocally(token) {
    let header;
    try {
      header = jwt.decode(token, { complete: true })?.header;
    } catch {
      return null;
    }
    if (!header || header.alg !== "RS256") return null;

    const key = await this.getVerificationKey(header.kid);
    if (!key) return null;

    try {
      const decoded = jwt.verify(token, key, {
        algorithms: ["RS256"],
        issuer: "workhub-identity",
        audience: "workhub-api-gateway",
      });
      return {
        userId: String(decoded.sub),
        role: decoded.role,
        sid: decoded.sid || null,
        tokenVersion: decoded.tokenVersion,
        exp: decoded.exp,
      };
    } catch {
      return null;
    }
  }

  /**
   * Ask identity-service whether a token is currently active.
   */
  async introspect(token) {
    const res = await this.request("/internal/auth/introspect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": this.internalSecret,
        "X-Service-Name": this.serviceName,
      },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) throw new Error(`Introspection returned ${res.status}`);
    return res.json();
  }

  /**
   * Resolve a token to a user, using the cache when possible.
   *
   * A locally-valid signature is necessary but not sufficient: revocation and
   * tokenVersion live in identity, so an uncached token is always introspected.
   * `strict` (used for mutations) turns an identity outage into an error the
   * caller can surface as 502 rather than silently treating the request as
   * anonymous.
   */
  async resolve(token, { strict = false } = {}) {
    const cached = this.cache.get(token);
    if (cached) return cached;

    try {
      const body = await this.introspect(token);
      if (!body || !body.active) {
        // Negative results are cached briefly too, so a stream of requests
        // carrying one dead token does not hammer identity.
        this.cache.set(token, null, { ttlMs: 5000 });
        return null;
      }

      const result = { active: true, user: body.user, sessionId: body.sessionId || null };
      const ttlMs = body.expiresIn ? Math.min(body.expiresIn * 1000, 15000) : undefined;
      this.cache.set(token, result, { ttlMs });
      return result;
    } catch (err) {
      if (strict) throw err;
      return null;
    }
  }

  evictUser(userId) {
    return this.cache.evictUser(userId);
  }

  stats() {
    return {
      cache: this.cache.stats(),
      jwks: {
        keyCount: this.jwks.keys.size,
        kids: [...this.jwks.keys.keys()],
        fetchedAt: this.jwks.fetchedAt ? new Date(this.jwks.fetchedAt).toISOString() : null,
      },
    };
  }
}

module.exports = { IdentityClient, JWKS_PATH };
