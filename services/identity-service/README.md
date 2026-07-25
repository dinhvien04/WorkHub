# WorkHub Identity Service

Strangler fig microservice owning global user authentication, session revocation, MFA, and passkey credentials.

## Endpoint API
- `POST /api/auth/register` - Create user principal
- `POST /api/auth/login` - Create user session
- `POST /api/auth/logout` - Revoke active session
- `GET /api/auth/me` - Get active session metadata
- `GET /api/sessions` - List user active sessions
- `DELETE /api/sessions/:id` - Revoke session
- `POST /api/sessions/logout-all` - Logout all user sessions

## Internal Endpoint API (Gateway-only)
- `POST /internal/auth/introspect` - Introspect session status
- `POST /internal/auth/revoke` - Revoke session by ID
- `GET /.well-known/jwks.json` - JWKS public key set

## Hashing Algorithms
- Bcrypt cost 12 (backward compatibility check)
- Argon2id time=3, memory=65536, parallel=4 (new/rehashed credentials)
