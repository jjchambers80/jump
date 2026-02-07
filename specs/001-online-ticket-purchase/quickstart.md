# Quick Start: Online Ticket Purchase and QR Code Generation

**Feature**: 001-online-ticket-purchase  
**Branch**: `001-online-ticket-purchase`  
**Tech Stack**: Node.js 20, Express.js 4, Next.js 14, PostgreSQL 15, Redis 7, Prisma 5

## Prerequisites

- **Node.js**: 20.x LTS ([download](https://nodejs.org/))
- **PostgreSQL**: 15+ ([download](https://www.postgresql.org/download/))
- **Redis**: 7.x ([download](https://redis.io/download/))
- **Git**: For version control
- **Stripe Account**: Test API keys ([sign up](https://stripe.com/))
- **SendGrid Account**: Email API key ([sign up](https://sendgrid.com/))

**Verify Installations**:

```bash
node --version   # Should show v20.x.x
npm --version    # Should show 10.x.x
psql --version   # Should show 15.x or higher
redis-server --version  # Should show 7.x.x
```

---

## Project Setup

### 1. Clone and Install Dependencies

```bash
# Clone repository
git clone <repository-url> jump
cd jump

# Checkout feature branch
git checkout 001-online-ticket-purchase

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Environment Configuration

**Backend** (`backend/.env`):

```env
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/jump_dev"

# Redis
REDIS_URL="redis://localhost:6379"

# Stripe
STRIPE_SECRET_KEY="sk_test_..." # Get from Stripe Dashboard
STRIPE_PUBLISHABLE_KEY="pk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..." # Get after webhook setup (step 5)

# JWT
JWT_SECRET="your-256-bit-secret-key-here" # Generate with: openssl rand -base64 32

# Email
SENDGRID_API_KEY="SG...." # Get from SendGrid Dashboard
SENDGRID_FROM_EMAIL="noreply@jump.example.com"

# Server
PORT=3000
NODE_ENV=development

# Session
SESSION_SECRET="another-secure-random-string" # Generate with: openssl rand -base64 32
SESSION_TTL=86400  # 24 hours in seconds
```

**Frontend** (`frontend/.env.local`):

```env
NEXT_PUBLIC_API_URL="http://localhost:3000/api/v1"
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

### 3. Database Setup

**Create Database**:

```bash
psql -U postgres
CREATE DATABASE jump_dev;
\q
```

**Run Prisma Migrations**:

```bash
cd backend
npx prisma migrate dev --name init_online_ticket_purchase
```

This creates:

- Tables: `admins`, `customers`, `events`, `tickets`, `payment_transactions`, `sessions`
- Indexes: All required indexes from data-model.md
- Enums: EventStatus, TicketStatus, PaymentStatus, UserType

**Seed Test Data** (optional):

```bash
npx prisma db seed
```

Creates:

- Test admin: `admin@test.com` / `testpass123`
- Test customer: `customer@test.com` / `testpass123`
- Test event: "Test Concert" (capacity: 100, price: $50)

**Verify Database**:

```bash
npx prisma studio
```

Opens GUI at `http://localhost:5555` to browse tables.

### 4. Redis Setup

**Start Redis Server**:

```bash
# macOS (Homebrew)
brew services start redis

# Linux
sudo systemctl start redis

# Manual start
redis-server
```

**Verify Redis**:

```bash
redis-cli ping
# Should return: PONG
```

### 5. Stripe Webhook Setup (Local Development)

**Install Stripe CLI**:

```bash
# macOS
brew install stripe/stripe-cli/stripe

# Other platforms: https://stripe.com/docs/stripe-cli
```

**Login to Stripe**:

```bash
stripe login
```

**Forward Webhooks to Local Server**:

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

**Copy Webhook Secret**:
The CLI will display:

```
> Ready! Your webhook signing secret is whsec_xxxxx
```

Add this to `backend/.env` as `STRIPE_WEBHOOK_SECRET`.

---

## Running the Application

### Development Mode

**Terminal 1 - Backend**:

```bash
cd backend
npm run dev
```

Server starts at `http://localhost:3000`

**Terminal 2 - Frontend**:

```bash
cd frontend
npm run dev
```

App starts at `http://localhost:3001`

**Terminal 3 - Stripe Webhook Forwarding** (keep running):

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

**Terminal 4 - Redis** (if not running as service):

```bash
redis-server
```

### Verify Setup

1. **Backend Health**: `curl http://localhost:3000/api/v1/health` → `{"status": "ok"}`
2. **Frontend**: Visit `http://localhost:3001` → Should see event listing
3. **Admin Portal**: Visit `http://localhost:3001/admin` → Login with test admin

---

## Testing

### Unit Tests

```bash
# Backend
cd backend
npm test

# Frontend
cd frontend
npm test
```

### Contract Tests (API Endpoints)

```bash
cd backend
npm run test:contract
```

Tests all endpoints against OpenAPI schema in `contracts/api.yaml`.

### Integration Tests (E2E Purchase Flow)

```bash
cd frontend
npm run test:e2e
```

Uses Playwright to test complete ticket purchase flow:

1. Browse events
2. Select tickets
3. Complete Stripe Checkout (test mode)
4. Receive QR codes

### Load Testing (Capacity Enforcement)

```bash
cd backend
npm run test:load
```

Simulates 100 concurrent purchase attempts for event with 50 capacity (validates FR-009).

---

## Development Workflow

### TDD Workflow (Constitution Principle III)

1. **Write Test** (Red phase):

   ```bash
   cd backend/tests/integration
   # Create test file: ticket-purchase.test.ts
   npm test -- ticket-purchase.test.ts  # Fails (not implemented)
   ```

2. **Implement Feature** (Green phase):

   ```bash
   cd backend/src
   # Create route handler, service logic
   npm test -- ticket-purchase.test.ts  # Passes
   ```

3. **Refactor** (Refactor phase):
   ```bash
   # Improve code clarity while tests remain green
   npm test  # All tests still pass
   ```

### Database Changes

**Create Migration**:

```bash
cd backend
# Modify schema.prisma
npx prisma migrate dev --name <description>
```

**Reset Database** (development only):

```bash
npx prisma migrate reset  # Drops DB, runs all migrations, seeds data
```

### API Contract Updates

1. Edit `specs/001-online-ticket-purchase/contracts/api.yaml`
2. Validate: `npx @redocly/cli lint contracts/api.yaml`
3. Preview: `npx @redocly/cli preview-docs contracts/api.yaml`
4. Generate types: `npm run generate:types`

### Code Quality

**Lint Code**:

```bash
npm run lint       # ESLint
npm run lint:fix   # Auto-fix issues
```

**Format Code**:

```bash
npm run format     # Prettier
```

**Type Check**:

```bash
npm run type-check  # TypeScript
```

---

## Common Tasks

### Create Admin Account (Manual)

```bash
cd backend
node scripts/create-admin.js --email admin@example.com --name "Admin Name" --org "Org Name"
# Outputs temporary password
```

### Generate QR Code Locally

```bash
node scripts/generate-qr.js --ticket-id <uuid>
# Saves QR code PNG to ./temp/qr-<uuid>.png
```

### Check Metrics

```bash
curl http://localhost:3000/metrics
```

Returns Prometheus-format metrics (FR-025):

- `http_request_duration_ms`
- `ticket_sales_total`
- `payment_status_total`
- `qr_generation_total`
- `active_sessions`

### Tail Logs

```bash
cd backend
npm run logs
```

Streams Winston JSON logs with correlation IDs.

---

## Troubleshooting

### Database Connection Errors

**Error**: `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Fix**:

```bash
# Check PostgreSQL is running
pg_isready

# Start PostgreSQL
# macOS: brew services start postgresql@15
# Linux: sudo systemctl start postgresql
```

### Redis Connection Errors

**Error**: `Error: connect ECONNREFUSED 127.0.0.1:6379`

**Fix**:

```bash
redis-cli ping  # Should return PONG
# If not: redis-server &
```

### Stripe Webhook Signature Failures

**Error**: `No signatures found matching the expected signature`

**Fix**:

1. Ensure `stripe listen` is running
2. Copy webhook secret from CLI output to `.env`
3. Restart backend: `npm run dev`

### Prisma Type Errors

**Error**: `Property 'event' does not exist on type 'Ticket'`

**Fix**:

```bash
npx prisma generate  # Regenerate Prisma Client types
```

### Port Already in Use

**Error**: `Error: listen EADDRINUSE: address already in use :::3000`

**Fix**:

```bash
# Find process using port 3000
lsof -ti:3000
# Kill process
kill -9 <PID>
```

---

## Architecture Overview

```
┌─────────────────┐         ┌──────────────────┐
│   Frontend      │         │     Backend      │
│   (Next.js)     │◄───────┤   (Express.js)   │
│   Port 3001     │  HTTP   │   Port 3000      │
└─────────────────┘         └──────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
               ┌────▼────┐      ┌───▼────┐     ┌────▼─────┐
               │PostgreSQL│      │ Redis  │     │  Stripe  │
               │ Port 5432│      │Port 6379│     │  API     │
               └──────────┘      └────────┘     └──────────┘
```

**Request Flow** (Ticket Purchase):

1. Customer → Frontend (Next.js)
2. Frontend → Backend `/tickets/purchase` (Express.js)
3. Backend → PostgreSQL (capacity check with `FOR UPDATE` lock)
4. Backend → Stripe API (create Checkout session)
5. Backend → Frontend (return `checkoutUrl`)
6. Customer → Stripe Checkout (external)
7. Stripe → Backend `/webhooks/stripe` (payment confirmation)
8. Backend → PostgreSQL (create tickets)
9. Backend → SendGrid (email QR codes)
10. Customer → Frontend `/tickets/confirm` (display QR codes)

---

## Next Steps

After setup:

1. **Run Tests**: `npm test` (backend and frontend)
2. **Test Purchase Flow**: Complete test ticket purchase with Stripe test card `4242 4242 4242 4242`
3. **Review Logs**: Check Winston logs for correlation IDs and metrics
4. **Explore API**: Use Swagger UI (`npx @redocly/cli preview-docs contracts/api.yaml`)
5. **Read Docs**: Review `docs/` folder (generated per Constitution Principle VIII)

---

## Production Deployment (Future)

**Not covered in MVP setup**:

- Container builds (Dockerfile for backend/frontend)
- Database migration strategy (zero-downtime)
- Redis Sentinel/Cluster (high availability)
- Environment-specific configs (staging, production)
- Monitoring setup (Prometheus + Grafana)
- SSL/TLS certificates (Let's Encrypt)
- Horizontal scaling (load balancer configuration)

Defer to post-MVP deployment planning.

---

## Resources

- **Prisma Docs**: https://www.prisma.io/docs
- **Stripe Test Cards**: https://stripe.com/docs/testing
- **Next.js Docs**: https://nextjs.org/docs
- **Express.js Docs**: https://expressjs.com/
- **Redis Commands**: https://redis.io/commands
- **PostgreSQL Docs**: https://www.postgresql.org/docs/

---

## Support

For issues or questions:

1. Check [Troubleshooting](#troubleshooting) section above
2. Review contract tests: `npm run test:contract`
3. Consult `research.md` for architecture decisions
4. Refer to `data-model.md` for database schema

Constitution Principle VIII: Living Documentation ensures all decisions are documented in `/docs` folder (generated during implementation).
