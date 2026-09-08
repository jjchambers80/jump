# Observability

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Winston-based structured logging with correlation IDs, Prometheus metrics endpoint, and a health check. Every request is tagged with an `X-Correlation-ID` header (auto-generated if missing) that propagates through the entire request lifecycle.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/utils/logger.js` | Winston logger configuration with correlation ID support |
| `backend/src/utils/metrics.js` | Prometheus metrics collection and registration |
| `backend/src/api/server.js` | Health check endpoint, metrics endpoint, request logging middleware |

## How It Works

1. Incoming requests are checked for an `X-Correlation-ID` header; one is generated if missing.
2. The correlation ID is attached to the request context and included in all log entries for that request.
3. Winston logs structured output with request timing information.
4. Prometheus metrics are collected for request counts, durations, and error rates.
5. `GET /metrics` exposes Prometheus-formatted metrics for scraping.
6. `GET /health` returns a simple health check response.

## Gotchas

- Correlation IDs propagate through the entire request lifecycle — useful for tracing across logs.
- The `/metrics` endpoint is unauthenticated, intended for Prometheus scraping.
- The `/health` endpoint is also unauthenticated, intended for load balancer health checks.

## Related Features

- [Railway Deployment](railway-deployment.md) — health checks used by Railway for service monitoring.
