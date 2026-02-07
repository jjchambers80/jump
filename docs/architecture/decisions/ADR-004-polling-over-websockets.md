# ADR-004: Polling Over WebSockets for Real-Time Dashboard

**Status**: Accepted  
**Date**: 2026-02-04  
**Decision Makers**: Engineering Team  
**Context**: Feature 001 – Online Ticket Purchase and QR Code Generation

## Context

The admin dashboard (FR-014) displays real-time metrics including total capacity, tickets sold, and remaining tickets. The success criteria (SC-006) require inventory updates to be visible within 2 seconds. We needed to decide the mechanism for delivering real-time updates to the admin dashboard.

## Decision

**Use HTTP polling with a 5-second interval** for admin dashboard updates.

The admin dashboard uses `useEffect` with `setInterval` to poll the `GET /admin/dashboard/stats` endpoint every 5 seconds, with proper cleanup on component unmount.

## Rationale

- **Simplicity** (Constitution Principle VII): HTTP polling requires no additional infrastructure — the existing REST API and Express server handle everything. No WebSocket server, connection upgrades, or sticky sessions needed.
- **Sufficient for Use Case**: The admin dashboard is a monitoring tool, not a real-time trading interface. 5-second intervals provide adequate responsiveness for sales monitoring (SC-006 requires <2s database updates, not <2s UI updates).
- **Stateless Architecture**: Polling works with any load-balanced backend instance. WebSockets require sticky sessions or a shared message bus (Redis Pub/Sub), adding operational complexity.
- **Reliability**: Each poll is an independent HTTP request. Connection drops are automatically recovered on the next interval. No reconnection logic, heartbeat management, or connection state tracking needed.
- **Resource Efficiency**: Dashboard is typically used by a small number of admins (not hundreds). The polling overhead is negligible compared to customer-facing traffic.

## Alternatives Considered

| Alternative                  | Pros                                         | Cons                                                                                         | Why Rejected                                         |
| ---------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **WebSockets**               | True real-time (<100ms), bidirectional       | Sticky sessions, connection management, reconnection logic, additional server infrastructure | Over-engineered for admin dashboard use case         |
| **Server-Sent Events (SSE)** | Unidirectional push, simpler than WebSockets | Connection management, proxy compatibility issues, less proven with load balancers           | Moderate complexity gain for marginal benefit        |
| **Long Polling**             | Near-real-time, no special protocol          | Server resource holding, connection management                                               | More complex than simple polling, no clear advantage |
| **GraphQL Subscriptions**    | Type-safe, selective data updates            | Requires GraphQL infrastructure, WebSocket transport                                         | Complete architecture change for one feature         |

## Consequences

### Positive

- Zero additional infrastructure or libraries
- Works with any deployment topology (load balancers, CDNs, reverse proxies)
- Simple implementation (5 lines of `useEffect` code)
- Automatic recovery from network interruptions
- Easy to debug (regular HTTP requests visible in browser DevTools)

### Negative

- 5-second maximum latency between data change and UI update
- Slightly higher network overhead vs. push-based approaches (but negligible for admin traffic)
- Server processes requests even when no data has changed

### Upgrade Path

If sub-second updates become necessary:

1. **Server-Sent Events (SSE)**: Minimal code change, unidirectional push
2. **WebSockets**: Full bidirectional communication
3. **Redis Pub/Sub + SSE**: Scalable real-time with multiple server instances

The current polling implementation is isolated in the Dashboard component's `useEffect`, making replacement straightforward.
