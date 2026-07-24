# M2 Pass-through API Gateway Configuration

This document describes the API Gateway architecture, proxy configuration, and integration tests created during the M2 phase.

## API Gateway Architecture
The API Gateway acts as the single public entry point for all client requests. In Phase M2, it routes 100% of incoming traffic directly to the relocated legacy monolith application (`apps/legacy-monolith`).

```
[ Client Requests ]
       │
       ▼ (Port 3000)
┌──────────────┐
│ API Gateway  │
└──────┬───────┘
       │
       ▼ (Proxy Pass-through / Port 3001)
┌──────────────────────┐
│ apps/legacy-monolith │
└──────────────────────┘
```

## Features Implemented
- **Request ID Generation:** Appends a unique `X-Request-Id` UUID to every request and response header.
- **Trace Context Propagation:** Forwards W3C traceparent headers to down-stream services.
- **Payload & Connection Protections:** Incorporates maximum request timeouts (60 seconds) and edge rate-limiting protections.
- **Error Formatting:** Returns standard JSON errors (502 Bad Gateway / 504 Gateway Timeout) when the backend monolith service is unresponsive.
- **WebSocket Forwarding:** Supports HTTP connection upgrade for real-time Socket.IO communication.

## Verification
Gateway operations are verified using `apps/api-gateway/gateway.test.js`, testing proxy routing, Request ID injection, and error formatting.
