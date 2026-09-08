# Jump Platform — Feature Wiki

Living documentation of every feature in the Jump ticketing platform. Each page covers what the feature does, how it's configured, key files, and gotchas.

Generated and maintained by running `/doc-feature` after completing feature work.

## Features

### Core Platform
- [Multi-Tenant Architecture](features/multi-tenant-architecture.md) — Organizations, venues, org-scoped resources
- [Event Management](features/event-management.md) — CRUD, lifecycle (draft/published/cancelled), capacity
- [Price Tiers](features/price-tiers.md) — Multi-tier pricing, inventory tracking, display ordering
- [Guest Checkout](features/guest-checkout.md) — Stripe Checkout flow, contact creation, order management

### Payments & Pricing
- [Stripe Integration](features/stripe-integration.md) — Payment processing, webhooks, Checkout Sessions
- [Fee Calculation](features/fee-calculation.md) — Platform fees, processing fees, pass-through pricing
- [Tax Calculation](features/tax-calculation.md) — Venue-based tax rates via Stripe Tax API
- [All-In Pricing](features/all-in-pricing.md) — FTC-compliant price display with fees included

### Tickets & Fulfillment
- [Ticket Issuance](features/ticket-issuance.md) — Barcode generation, QR code JWTs, ticket lifecycle
- [QR Code Scanning](features/qr-code-scanning.md) — Redemption flow, JWT verification, admin scanner
- [Email Notifications](features/email-notifications.md) — Transactional emails via Resend with retry

### Authentication & Authorization
- [Auth.js Integration](features/authjs-integration.md) — OAuth (Google), magic links, JWT strategy
- [Role-Based Access Control](features/rbac.md) — Customer/Organizer/Admin roles, middleware enforcement

### Admin & Organizer
- [Admin Dashboard](features/admin-dashboard.md) — Stats, event management, analytics
- [Organization Settings](features/organization-settings.md) — Business details, staff (OrganizationPerson)
- [Venue Management](features/venue-management.md) — CRUD, logo uploads, timezone config
- [User Management](features/user-management.md) — Role assignment, account listing

### Frontend
- [Theme System](features/theme-system.md) — Light/dark/auto modes, localStorage persistence
- [Org Switcher](features/org-switcher.md) — Global organization context in admin header

### Infrastructure
- [Observability](features/observability.md) — Winston logging, Prometheus metrics, correlation IDs
- [Database Architecture](features/database-architecture.md) — Prisma, shared @jump/db package, migrations
- [Railway Deployment](features/railway-deployment.md) — Production deployment, Railpack configs

## Configuration Reference
- [Environment Variables](config/environment-variables.md)
- [Stripe Setup](config/stripe-setup.md)
- [Database Setup](config/database-setup.md)

## Contributing

After completing a feature, run `/doc-feature` to generate or update the wiki page. The skill will:
1. Ask which feature was built/changed
2. Scan relevant source files
3. Generate a standardized wiki page
4. Update this index
