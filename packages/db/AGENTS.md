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

## Models (12 models, 6 enums)

Core chain: Organization → Venue → Event → PriceTier → OrderItem → Ticket
Supporting: User, Account, Session, Contact, Order, PaymentTransaction

## Seed Data

`prisma/seed.js` — Run via `npm run db:seed`. Update when adding required fields.
