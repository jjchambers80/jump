# Shared DB Package — Scoped Agent Instructions

Loads when agent touches `packages/db/` files. For root-level commands, see [`../../AGENTS.md`](../../AGENTS.md).

## This Package

- Exports singleton Prisma client as `@jump/db`
- All workspaces import from here: `import { prisma } from "@jump/db"`
- Never instantiate PrismaClient elsewhere

## Schema Changes

1. Edit `prisma/schema.prisma`
2. `npm run db:migrate` from repo root (creates migration + applies)
3. `npm run db:generate` from repo root (regenerates client types)
4. Postinstall hook runs generate automatically on `npm install`

## Models (18 models, 10 enums)

Core chain: Organization → Venue → Event → PriceTier → OrderItem → Ticket
Supporting: User, OrganizationMember, Account, VerificationToken, Contact, Order, PaymentTransaction, Refund, OrganizationPerson, TierPreset, File, Image
Enums: UserRole, MemberRole (ADMIN/ORGANIZER, per-org staff role), OrganizationStatus, ThemeMode (LIGHT/DARK/SYSTEM, org public-page enforcement), EventStatus, OrderStatus, TierVisibility, TicketStatus, PaymentStatus, RefundStatus

Tenancy: `Contact` is unique on `(organizationId, email)`; `OrganizationMember` replaces the legacy `User.organizationId` (still present, unread, dropped in spec 007 phase 4). Migration `20260913000000_contact_per_org_and_membership` backfills both in one transaction.

## Seed Data

`prisma/seed.ts` — Run via `npm run db:seed`. Update when adding required fields.
