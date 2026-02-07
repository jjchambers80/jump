# ADR-001: Monolithic Backend Architecture

**Status**: Accepted  
**Date**: 2026-02-04  
**Decision Makers**: Engineering Team  
**Context**: Feature 001 – Online Ticket Purchase and QR Code Generation

## Context

We needed to choose an architecture pattern for the Jump Tickets backend that would handle ticket purchases, payment processing (Stripe), QR code generation, session management, and admin operations. The system targets 100 concurrent purchases and events with up to 100,000 capacity.

## Decision

**Adopt a monolithic Express.js backend** deployed as a single service.

All domain logic (events, tickets, payments, auth, admin) lives in one codebase and one deployable artifact.

## Rationale

- **MVP Simplicity** (Constitution Principle VII): A single deployable unit avoids the operational complexity of service discovery, inter-service authentication, distributed transactions, and deployment orchestration.
- **Transactional Integrity** (Constitution Principle IV): Atomic payment→ticket→inventory operations are simpler within a single process using database transactions, avoiding the complexity of distributed sagas.
- **Developer Velocity**: One codebase with shared types and models accelerates development. No need for API contracts between internal services.
- **Debugging**: Single process with correlation IDs makes request tracing straightforward without distributed tracing infrastructure (Jaeger/Zipkin).
- **Horizontal Scaling**: The monolith is stateless (sessions in Redis, data in PostgreSQL), so it can scale horizontally by running multiple instances behind a load balancer.

## Alternatives Considered

| Alternative                                                 | Pros                                    | Cons                                                            | Why Rejected                                       |
| ----------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| **Microservices** (separate payment, ticket, auth services) | Independent scaling, technology freedom | Distributed transactions, network latency, operational overhead | Overkill for MVP; premature optimization           |
| **Serverless Functions** (AWS Lambda / Azure Functions)     | Auto-scaling, no server management      | Cold starts, 15-min timeout limits, harder to test locally      | Database connection pooling issues, vendor lock-in |
| **Modular Monolith**                                        | Domain separation within monolith       | Additional abstraction overhead                                 | Unnecessary complexity for current feature set     |

## Consequences

### Positive

- Faster development and deployment cycle
- Simpler local development setup
- Easier debugging and logging
- Database transactions handle all atomicity requirements

### Negative

- All features share the same deployment cycle
- Single point of failure (mitigated by horizontal scaling)
- May need refactoring if domain boundaries diverge significantly

### Future Considerations

- If a specific service (e.g., payment processing) needs independent scaling, extract it as a separate service
- Monitor request patterns to identify if any domain becomes a bottleneck
- The modular code structure (services/routes separation) makes future extraction straightforward
