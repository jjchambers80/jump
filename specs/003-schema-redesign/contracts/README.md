# API Contracts — Schema Redesign

**Feature**: 003-schema-redesign  
**Format**: OpenAPI 3.0.3

## Contract File

- [api.yaml](api.yaml) — Full OpenAPI specification for all new and updated endpoints

## Endpoint Summary

| Method | Path                                 | Tag           | Auth        | FR     |
| ------ | ------------------------------------ | ------------- | ----------- | ------ |
| GET    | `/organizations`                     | Organizations | Admin       | FR-048 |
| POST   | `/organizations`                     | Organizations | Admin       | FR-048 |
| GET    | `/organizations/{id}`                | Organizations | Admin       | FR-048 |
| PATCH  | `/organizations/{id}`                | Organizations | Admin       | FR-048 |
| GET    | `/organizations/{orgId}/venues`      | Venues        | Org-scoped  | FR-049 |
| POST   | `/organizations/{orgId}/venues`      | Venues        | Org-scoped  | FR-049 |
| GET    | `/organizations/{orgId}/venues/{id}` | Venues        | Org-scoped  | FR-049 |
| PATCH  | `/organizations/{orgId}/venues/{id}` | Venues        | Org-scoped  | FR-049 |
| DELETE | `/organizations/{orgId}/venues/{id}` | Venues        | Org-scoped  | FR-049 |
| GET    | `/events`                            | Events        | Public      | FR-050 |
| GET    | `/events/{id}`                       | Events        | Public      | FR-050 |
| GET    | `/organizations/{orgId}/events`      | Events        | Org-scoped  | FR-050 |
| POST   | `/organizations/{orgId}/events`      | Events        | Org-scoped  | FR-050 |
| PATCH  | `/organizations/{orgId}/events/{id}` | Events        | Org-scoped  | FR-050 |
| POST   | `.../events/{id}/publish`            | Events        | Org-scoped  | FR-050 |
| POST   | `.../events/{id}/cancel`             | Events        | Org-scoped  | FR-050 |
| GET    | `.../events/{id}/price-tiers`        | PriceTiers    | Public      | FR-051 |
| POST   | `.../events/{id}/price-tiers`        | PriceTiers    | Org-scoped  | FR-051 |
| PATCH  | `.../price-tiers/{id}`               | PriceTiers    | Org-scoped  | FR-051 |
| POST   | `.../price-tiers/{id}/activate`      | PriceTiers    | Org-scoped  | FR-051 |
| POST   | `.../price-tiers/{id}/deactivate`    | PriceTiers    | Org-scoped  | FR-051 |
| POST   | `.../price-tiers/reorder`            | PriceTiers    | Org-scoped  | FR-051 |
| POST   | `/orders`                            | Orders        | Public      | FR-052 |
| GET    | `/orders/{id}`                       | Orders        | Owner/Admin | FR-053 |
| POST   | `/orders/lookup`                     | Orders        | Public      | FR-054 |
| GET    | `/orders/my`                         | Orders        | Auth        | FR-053 |
| GET    | `/events/{id}/orders`                | Orders        | Org-scoped  | FR-053 |
| POST   | `/tickets/redeem`                    | Tickets       | Auth        | FR-055 |
| GET    | `/users`                             | Users         | Admin       | FR-056 |
| PATCH  | `/users/{id}`                        | Users         | Admin       | FR-056 |
| GET    | `.../events/{id}/analytics`          | Analytics     | Org-scoped  | FR-057 |
| POST   | `/webhooks/stripe`                   | Webhooks      | Stripe sig  | FR-029 |

## Authentication

All authenticated endpoints use **Auth.js v5 JWT** tokens in the `Authorization: Bearer <token>` header. Tokens are HS256-signed with the shared `AUTH_SECRET`. The JWT payload includes:

```json
{
  "sub": "cuid_user_id",
  "email": "user@example.com",
  "role": "ORGANIZER",
  "name": "Jane Doe",
  "iat": 1707350400,
  "exp": 1707436800
}
```

The Express backend verifies tokens using `jsonwebtoken.verify(token, AUTH_SECRET, { algorithms: ['HS256'] })`.
