# Research & Discovery

Customer interviews, competitor notes, and market research that inform the [roadmap](../roadmap.md).

Each entry has an analysis document (summary, user stories, pain points, feature candidates) and, where available, the raw source under `transcripts/`. The raw source wins when the two disagree.

| Date | Document | Subject | Feeds |
|---|---|---|---|
| 2026-09-15 | [Organizer interview — Eventeny pain points](./2026-09-15-eventeny-organizer-interview.md) | Gaming Geek Expo organizer on Eventeny: pricing, fees, applications, messaging, map, permissions | Roadmap candidates 011–015 |
| 2026-09-26 | [Social SDK — integrated marketing](./2026-09-26-social-sdk-integrated-marketing.md) | `opencoredev/social-sdk`: one TypeScript API for publishing to Bluesky, Instagram, LinkedIn, Threads, TikTok, X, YouTube | Possible integrated marketing feature (no spec yet) |
| 2026-10-05 | [Agent store access — MCP + OAuth](./2026-10-05-agent-store-access.md) | Letting organizers' own LLMs/agents (ChatGPT, Claude, Claude Code, Codex) manage a store: options, remote MCP server with Jump as OAuth 2.1 AS, scopes, confirmations, audit, threat model | Spec 045 (agent access); cross-tenant route fix PR #303 |
| 2026-10-07 | [Photo galleries](./2026-10-07-photo-galleries.md) | Content › Galleries with sections over Content › Files; carousel + masonry/lightbox for Puck and rich-text pages; competitor survey (Shopify, Squarespace, Wix, WordPress/Jetpack, SmugMug, Pixieset, Flickr, Google Photos, Webflow, Framer); WCAG 2.2 AA checklist; library comparison | Spec 046 (photo galleries); supersedes the spec 038 inline `Gallery` section idea |

## Conventions

- Filename: `YYYY-MM-DD-<subject>.md`; transcript: `transcripts/YYYY-MM-DD-<subject>.md`.
- Keep transcripts verbatim; note transcription errors in a header, do not silently fix them.
- Analysis sections: profile, pricing, feature inventory, pain points, pitfalls to avoid, user stories, feature candidates mapped to Jump, open questions.
- Reported figures are the interviewee's recollection unless marked verified.
