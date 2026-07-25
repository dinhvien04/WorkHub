# ADR 008: Session Revocation Strategy

## Status
Accepted

## Context
When a user logs out, changes their password, or gets banned by an admin, their active JWT access token must be invalidated instantly. Since asymmetric JWTs are stateless, we must establish a verification strategy at the Gateway boundary to check session and token validity without re-introducing synchronous database queries on every HTTP request.

## Decisions
1. **Introspection Endpoint**:
   - Expose `POST /internal/auth/introspect` on the Identity Service. This endpoint validates the incoming JWT signature, and checks the user status (`Status: "active"`), token version (`tokenVersion` matches the DB), and session status (`SidHash` not revoked) against the authoritative database.
   - Secure the introspection API with the `IDENTITY_INTERNAL_SECRET` header check.

2. **Positive Caching**:
   - The Gateway validation middleware calls this introspection API for protected routes.
   - Cache positive introspection results for 15 seconds locally in the Gateway to prevent database exhaustion.
   - Evict the cache immediately upon receipt of `identity.session-revoked.v1` and `identity.user-status-changed.v1` events.

3. **Fail-Closed Policy**:
   - If the Identity Service is offline or returns an error, the Gateway must fail closed for mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`), returning a 502 Bad Gateway response. Public read-only routes are skipped.

## Consequences
- Guarantees immediate session revocation while preserving high performance at the Gateway boundary.
