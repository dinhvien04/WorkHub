# Current System Map

This document describes the high-level architecture, module organization, and critical routes of the WorkHub Monolith before service extraction.

## Monolith Architecture Diagram
```
                    [ API Gateway / Client ]
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
     [ Page Routes ]                      [ API Router ]
     (EJS Views / BFF)                (controllers/routes)
            │                                     │
            └──────────────────┬──────────────────┘
                               ▼
                        [ Services Layer ]
              (booking, payment, outbox, push, etc.)
                               │
                               ▼
                       [ Database Layer ]
                    (MongoDB / Mongoose)
```

## Module & Folder Map
- `/controllers`: API request validation, request-response handling, calling services.
- `/routes`: Endpoint mount points and route definitions.
- `/services`: Core business logic (Booking transaction loops, Outbox dispatch, Push notification formatting, Payment provider adapter).
- `/models`: Database schema structures (Mongoose).
- `/views`: Front-end presentation templates.
- `/public`: Static CSS/JS assets.
