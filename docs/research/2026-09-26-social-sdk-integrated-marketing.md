# Social SDK: possible tool for integrated marketing

> **Source:** [opencoredev/social-sdk](https://github.com/opencoredev/social-sdk) · docs at [social-sdk.dev/docs](https://social-sdk.dev/docs)
> **Saved:** 2026-09-26
> **Status:** Candidate only. Not evaluated in code, no roadmap spec yet.

## What it is

A TypeScript SDK that puts one typed interface over several social platforms, so a server can publish once and fan the post out to each network.

- **Direct adapters:** Bluesky, Instagram, LinkedIn, Threads, TikTok, X, YouTube.
- **Managed backends:** Zernio, Post for Me, PostFast, Postiz. These let a hosted service hold the platform app approvals and tokens instead of Jump.
- **Per-destination outcomes:** each target reports complete, processing, uncertain or failed on its own, so a partial failure is visible.
- **Capability manifests:** typed per-platform capabilities behind explicit subpath imports.
- **Mock backend:** deterministic, no credentials and no network calls.
- **CLI:** offline adapter discovery, capability checks, diagnostics, request validation.
- **Not included:** scheduling and analytics are not mentioned in the docs.

Runtime is Node.js 22.12+ or Bun, server side only (credentials must never reach the browser). MIT licensed. At the time of saving: about 257 stars and 245 commits.

```bash
npm install @opencoredev/social-sdk
```

## Why it matters for Jump

Organizers promote events on social media by hand today. An integrated marketing feature could let them publish an event announcement, a "tickets on sale" post or a "few left" post from the event page, using the event's title, date, cover image and storefront URL.

Possible uses:

- **Announce on publish:** optional share step when an event goes live.
- **Lifecycle posts:** on-sale, tier sold out, low inventory, day-of reminders.
- **Content reuse:** share a blog post (spec 026) to connected accounts.
- **Per-org connected accounts:** each organization connects its own social accounts under Settings, the same way it connects Stripe.

## Fit and constraints

- **Node version:** Jump declares `node >=20.0.0`. The SDK needs 22.12+, so adopting it means raising the backend engine and the Railway runtime.
- **Server side only:** it belongs in a backend service (for example a `SocialPublishService`) behind org-scoped admin routes. Tokens stay in the backend, encrypted at rest.
- **Tenancy:** connected accounts must be org-scoped, resolved through `activeOrgFor(req)`, like other settings.
- **Platform app review:** direct adapters need Jump to register and pass review as an app on each network (Meta, TikTok, X API pricing). A managed backend (Postiz, PostFast, and so on) avoids most of that at a per-post or subscription cost. Decide this first.
- **Scheduling:** the SDK has none. Jump would need its own sweep, like the existing order and application sweeps.
- **Tests:** the mock backend fits the rule that CI stays deterministic with no network.
- **Event times:** any post that includes a date must format it in the venue's time zone (gotcha 28).
- **Maturity:** a young project. Pin the version and wrap it behind one service so it can be replaced.

## Open questions

1. Direct adapters (Jump owns app approvals) or a managed backend (vendor owns them)?
2. Which networks matter to organizers first? The Eventeny interview did not cover social promotion.
3. Is this a paid-plan feature (spec 022 billing)?
4. Do we need post analytics (clicks to storefront)? UTM tags on storefront links could cover that without the SDK.
