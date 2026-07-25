# ADR 006: Identity Service Boundary

## Status
Accepted

## Context
During the migration of the legacy monolith into microservices, global authentication and session management are being extracted into a dedicated `identity-service` (M6). Given the complexity of the domain model, we must establish clear boundaries of database and logic ownership to ensure the microservice remains isolated, reusable, and secure, while avoiding cross-service database access or tight model coupling.

## Decisions
1. **Identity Service Owns**:
   - Authentication credentials (passwords, TOTP 2FA secret keys, recovery code hashes, WebAuthn credentials).
   - Global user role (`admin`, `host`, `customer`) and global account status (`active`, `inactive`, `banned`).
   - Session metadata (`user_sessions` collection, `PublicSessionID`, `SidHash`, `UserAgent`, `IP`, `AuthMethod`, `LastSeenAt`, `ExpiresAt`, `RevokedAt`).
   - Token creation, asymmetric RS256 JWT signing, and JWKS key management.
   - Verification token states (`email_verification_tokens`, `password_reset_tokens`).
   - Authentication audit log events.

2. **Identity Service DOES NOT Own** (Left in monolith, to be moved to Catalog/Booking domains in future phases):
   - Customer profile details (`CustomerProfile` schema, phone, avatar, job title).
   - Host business profile details (`HostProfile` schema, company name, tax code, banking information, verification doc files).
   - Host staff membership mapping (`StaffMember` schema) and host role permissions.
   - iCal calendar feeds.
   - Web Push subscriptions (`PushSubscription` model) and notification preferences.

3. **Onboarding Facade**:
   - Host registration calls will be facaded through the monolith's compatibility controller, which calls the internal Identity Service API to create the credential/principal, then saves the business profile fields in the monolith's database, resolving cross-domain write consistency.

## Consequences
- The User model in the Identity database is stripped of communication and profile fields.
- Identity database (`workhub_identity`) has zero shared tables, Mongoose schemas, or relative imports from the monolith or other services.
