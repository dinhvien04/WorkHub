# ADR 007: Asymmetric JWT and JWKS Design

## Status
Accepted

## Context
The legacy monolith issued symmetric HS256 JWT tokens signed with a shared `JWT_SECRET`. Since the auth validation is now decentralized, sharing a symmetric secret across multiple services increases the attack surface. We need a secure, cryptographically robust token design where only the Identity Service can sign tokens, and other services verify them using a public key.

## Decisions
1. **Asymmetric Signing**:
   - Transition to `RS256` (RSA Signature with SHA-256) asymmetric JWTs.
   - The Identity Service holds the private key securely in memory or loaded via environment variables/files, never committed to git.
   - Access tokens are signed using the RS256 private key.

2. **JWKS Exposure**:
   - Expose the public keys via a standard JWKS (JSON Web Key Set) endpoint `GET /.well-known/jwks.json` on the Identity Service.
   - The JWKS contains only standard parameters (`kty: "RSA"`, modulus `n`, exponent `e`, `use: "sig"`, `alg: "RS256"`, `kid` key ID). It never exposes private exponents.

3. **Key Rotation & Compatibility**:
   - Implement active and previous public key rotation overlap.
   - To support seamless live user transitions during the migration window, the Gateway supports a fallback verification path for legacy `HS256` user tokens based on explicit header algorithm checks.

## Consequences
- Reduces the risk of key leakage.
- Microservices do not require or load `JWT_SECRET`.
