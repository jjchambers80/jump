# Jump Backend API

The backend API for the Jump Ticketing Platform, built with Express.js 4.x on Node.js 20 LTS.

## Architecture

```
backend/
├── prisma/                 # Database schema and migrations
│   ├── schema.prisma       # Prisma data model
│   └── migrations/         # Migration history
├── src/
│   ├── api/
│   │   ├── server.js       # Express app entry point
│   │   ├── routes/         # Route handlers
│   │   │   ├── auth.js     # Authentication (register, login, logout)
│   │   │   ├── admin.js    # Admin portal (create/publish events, dashboard)
│   │   │   ├── events.js   # Public event listing
│   │   │   ├── tickets.js  # Ticket purchase and retrieval
│   │   │   └── webhooks.js # Stripe webhook handler
│   │   └── validators/     # Request validation middleware
│   ├── middleware/
│   │   ├── auth.js         # Session-based authentication
│   │   ├── rbac.js         # Role-based access control
│   │   └── errorHandler.js # Centralized error handling
│   ├── services/
│   │   ├── AuthService.js     # Registration, login, session management
│   │   ├── EventService.js    # Public event queries
│   │   ├── AdminEventService.js # Admin event CRUD
│   │   ├── TicketService.js   # Ticket creation and retrieval
│   │   ├── PaymentService.js  # Stripe checkout integration
│   │   ├── QRService.js       # JWT-based QR code generation
│   │   └── EmailService.js    # SendGrid email delivery
│   ├── utils/
│   │   ├── logger.js       # Winston structured logging
│   │   ├── metrics.js      # Prometheus metrics (prom-client)
│   │   ├── cache.js        # Redis caching utility
│   │   └── redis.js        # Redis client configuration
│   └── database/
│       └── seeds/          # Database seed scripts
└── tests/
    ├── setup.js            # Jest test setup
    ├── contract/           # API contract tests
    ├── integration/        # Integration tests
    └── unit/               # Unit tests (service layer)
```

## Tech Stack

| Technology   | Version | Purpose                   |
| ------------ | ------- | ------------------------- |
| Node.js      | 20 LTS  | Runtime                   |
| Express      | 4.x     | HTTP framework            |
| Prisma       | 5.x     | ORM / database access     |
| PostgreSQL   | 15+     | Primary database          |
| Redis        | 7+      | Session storage & caching |
| Stripe       | 17.x    | Payment processing        |
| bcrypt       | 5.x     | Password hashing          |
| jsonwebtoken | 9.x     | QR code JWT signing       |
| qrcode       | 1.5.x   | QR code image generation  |
| Winston      | 3.x     | Structured logging        |
| prom-client  | 15.x    | Prometheus metrics        |
| SendGrid     | 8.x     | Email delivery            |

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- PostgreSQL 15+
- Redis 7+
- Stripe account (test mode)

### Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your database and Stripe credentials

# Run database migrations
npm run db:migrate

# Seed test data
npm run db:seed
```

### Environment Variables

| Variable                | Description                    | Example                                      |
| ----------------------- | ------------------------------ | -------------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection string   | `postgresql://user:pass@localhost:5432/jump` |
| `REDIS_URL`             | Redis connection string        | `redis://localhost:6379`                     |
| `STRIPE_SECRET_KEY`     | Stripe API secret key          | `sk_test_...`                                |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret  | `whsec_...`                                  |
| `JWT_SECRET`            | Secret for QR code JWT signing | `your-256-bit-secret`                        |
| `FRONTEND_URL`          | Frontend URL for CORS          | `http://localhost:3001`                      |
| `SENDGRID_API_KEY`      | SendGrid API key for emails    | `SG.xxx`                                     |
| `PORT`                  | Server port                    | `3000`                                       |

### Running

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

The server starts at `http://localhost:3000` with:

- Health check: `GET /health`
- Metrics: `GET /metrics` (Prometheus format)

## Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit          # Unit tests (service layer mocks)
npm run test:contract      # API contract tests
npm run test:integration   # Database integration tests

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

> **Note**: Tests require `NODE_OPTIONS=--experimental-vm-modules` for ESM support (configured in package.json scripts).

## API Endpoints

### Authentication

| Method | Path             | Auth     | Description                   |
| ------ | ---------------- | -------- | ----------------------------- |
| POST   | `/auth/register` | None     | Register customer account     |
| POST   | `/auth/login`    | None     | Login (rate-limited: 5/15min) |
| POST   | `/auth/logout`   | Required | Invalidate session            |
| GET    | `/auth/me`       | Required | Get current user              |

### Events (Public)

| Method | Path               | Auth | Description                               |
| ------ | ------------------ | ---- | ----------------------------------------- |
| GET    | `/events`          | None | List published events (cached, paginated) |
| GET    | `/events/:eventId` | None | Get event details                         |

### Tickets

| Method | Path                 | Auth     | Description                            |
| ------ | -------------------- | -------- | -------------------------------------- |
| POST   | `/tickets/purchase`  | None     | Initiate Stripe checkout               |
| GET    | `/tickets/confirm`   | None     | Confirm purchase after Stripe redirect |
| GET    | `/tickets/my`        | Required | Customer's ticket history              |
| GET    | `/tickets/:ticketId` | Required | Ticket details with QR code            |

### Admin

| Method | Path                             | Auth  | Description          |
| ------ | -------------------------------- | ----- | -------------------- |
| POST   | `/admin/events`                  | Admin | Create event         |
| PATCH  | `/admin/events/:eventId`         | Admin | Update event         |
| POST   | `/admin/events/:eventId/publish` | Admin | Publish event        |
| GET    | `/admin/events`                  | Admin | List admin's events  |
| GET    | `/admin/dashboard/stats`         | Admin | Dashboard statistics |

### Webhooks

| Method | Path               | Auth             | Description           |
| ------ | ------------------ | ---------------- | --------------------- |
| POST   | `/webhooks/stripe` | Stripe Signature | Handle payment events |

## Deployment

The backend is deployed as a stateless Node.js application. It can be horizontally scaled behind a load balancer since all state is stored in PostgreSQL and Redis.

See [ADR-001](../docs/architecture/decisions/ADR-001-monolith-architecture.md) for architecture rationale.
