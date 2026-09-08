# Frontend — Scoped Agent Instructions

Loads when agent touches `frontend/` files. For root-level commands and env vars, see [`../AGENTS.md`](../AGENTS.md).

## Routing Structure

```
app/
├── admin/           # Organizer/admin dashboard (session-protected)
├── events/          # Public event browsing + detail pages
├── auth/            # Sign-in page
├── checkout/        # Cart + payment flow
├── confirmation/    # Post-purchase confirmation
├── my-tickets/      # Customer ticket list
├── orders/          # Order history
├── tickets/         # Individual ticket view (QR code)
├── venues/          # Venue pages
└── api/auth/        # Auth.js API route handler
```

## Key Files

- `auth.ts` — Auth.js v5 config (Google OAuth + magic link, JWT strategy)
- `services/api.ts` — All backend API calls go through here
- `components/` — Shared React components
- `lib/` — Utilities and helpers

## Patterns

- **Server vs Client**: Default to server components. Add `'use client'` only when needed for interactivity
- **Data fetching**: Server components fetch directly; client components call `services/api.ts`
- **Admin pages**: Must check session server-side and add to sidebar navigation
- **Search params**: Always wrap `useSearchParams()` consumers in `<Suspense fallback={...}>`

## Auth in Frontend

```typescript
// Server component — get session
import { auth } from "@/auth"
const session = await auth()

// API call with auth — services/api.ts handles Bearer token injection
```
