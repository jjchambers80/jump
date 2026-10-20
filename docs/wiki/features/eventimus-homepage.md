# Eventimus Homepage

**Status:** Implemented
**Last Updated:** 2026-10-20

## Overview

The platform root `/` is the Eventimus product homepage: one long, Shopify-style marketing page for organizers of conferences, conventions, expos, markets and festivals. It is a static server component with no API calls, so it renders without a backend.

**Platform hosts only.** On a tenant host (an organization's custom domain or its `<slug>.<root>` store subdomain), `frontend/src/middleware.ts` rewrites `/` to that store's homepage before this page is reached.

## Bands

Header (logo, Sign in → `/auth/signin`, Start selling → `/signup`), then eight dark bands, then the footer:

1. **Hero**: the h1, one subline, Start selling → `/signup`, Browse events → `/events`, and the `storefront-event.jpg` screenshot.
2. **Event types**: "Sell wherever your crowd gathers." with a static, wrapping list of event types. No logos and no motion.
3. **One place to run it**: branded store (with `storefront-mobile.jpg`), tickets / RSVPs / registrations, one admin.
4. **Fill your exhibit hall**: vendor, sponsor and speaker applications, review, floor map spot choice, payment. The booth grid is drawn in markup (`aria-hidden`), not an image.
5. **From first meetup to multi-day convention**: three event-size scenarios and the features each uses.
6. **A checkout buyers trust**: all-in prices (fees and tax before paying), Stripe checkout, capacity that never oversells.
7. **We've got your back**: door check-in by phone, refunds and automatic refunds on cancellation, staff roles.
8. **Start selling in three steps**: 01 / 02 / 03 and a final Start selling CTA.

`<main>` carries the `dark` class, so the bands (and the shared `primaryCta` / `secondaryCta` classes) always use their dark variants whatever the visitor's theme. The header and footer still follow the theme.

## Rules

- **Every claim must be a shipped feature that is on by default.** No statistics, prices or plans, customer logos or testimonials, AI or agent features, wallet passes, or session / agenda scheduling. Features behind dark flags (themes for every store, Stripe Connect payouts, billing, agent access) are not claimed. When a feature is removed or renamed, update this page.
- One h1; every band has an h2, and its cards use h3.
- The page stays one file with no `'use client'` and no data fetching. Content lives in the constants at the top of the file.

## Screenshots

`frontend/public/home/storefront-event.jpg` (an event page) and `storefront-mobile.jpg` (the store homepage on a phone) are screenshots of the real Raleigh Retro Gamers store in production. Keep their alt text in step with the images.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/app/page.tsx` | The page, its `metadata` and the band content |
| `frontend/e2e/eventimus-home.spec.ts` | Title, h1, CTA links, screenshot alt, every band h2, no overflow at 320 px |
| `frontend/src/lib/legal.ts` | `LEGAL_PAGES_ENABLED` gate for the footer Terms / Privacy links |
