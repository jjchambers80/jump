---
type: research
title: Home hero selling points — Raleigh Retro Gamers storefront
status: reference
created: 2026-10-07
updated: 2026-10-07
project: jump
tags: [jump, research, raleigh-retro-gamers, copy, hero, positioning, storefront]
source: live storefront frontend-production-43e9.up.railway.app (fetched 2026-10-07), raleighretrogamers.com, Jump theme registry at origin/main bacd723, comparable expo sites (see Sources)
---

# Home hero selling points: Raleigh Retro Gamers

**Question.** The home page hero of the Raleigh Retro Gamers (RRG) storefront, rendered at `/` through `HOME_ORGANIZATION=raleigh-retro-gamers`, needs selling points. The owner drafted two: **"Live market events"** and **"Diverse vendor network"**. Three questions:

1. Are those two right?
2. What else belongs in the hero?
3. What would finished hero copy look like?

**Method.**

- **Skills used.** `brand` (`.claude/skills/brand`): its messaging framework covers message architecture, proof points, message by audience, and the five tests (clear, differentiated, credible, compelling, consistent). Its voice framework supplies the "would a competitor say this?" test. `no-ai-slop` (`~/.claude/skills/no-ai-slop`) supplies the portability test, the banned-word list and the "be concrete" rule. `research` set the method: primary sources, cite every claim.
- **No marketing, CRO or copywriting skill is installed.** None exists in `~/.claude/skills`, `.claude/skills` or the plugin directories.
- **No brand guide exists for RRG.** The vault has none either: `/Users/jj/Brain/Brain/10_Personal/10_Projects/raleigh-retro-gamers--decision--homepage-video-hero.md` covers only the video. Voice is therefore inferred from the live pages.
- **What counts as a fact here.** Every claim about RRG below comes from the live storefront as fetched on 2026-10-07 [S1–S7] or from the RRG legacy site [S8].
- **Self-reported figures.** Numbers RRG states about itself (25,000+, #1, 90 %) appear exactly as RRG publishes them, marked **(self-reported)**. Nobody has verified them independently.

---

## 1. TL;DR

- **The current hero sells to vendors, not to attendees.** The live hero reads "Sell where the gamers are" and its one button is "Become a vendor" [S1]. The home page is also the page shoppers and ticket buyers land on, so decide the audience first (§3). The recommendation is to lead with attendees and keep "Become a vendor" as the second button.
- **"Live market events" is accurate but weak.** "Live" adds nothing, because every in-person event is live. "Market events" is generic: it fails the brand skill's "would a competitor say this?" test. It also leaves out the expo, esports and tournaments [S2]. Better: **"Pop-up markets, expos and esports across the Triangle"**.
- **"Diverse vendor network" is B2B language aimed at the wrong reader.**
  - "Network" is how you pitch to vendors and sponsors. A shopper cares about what is on the tables.
  - "Diverse" is vague, and some readers will take it as a statement about the vendors' demographics.
  - The attendee benefit underneath it is real and has proof behind it. RRG mixes gaming and geek vendors and limits overlap between them [S4]. Vendors must be "true experts", items must be "working and complete", and RRG has "zero-tolerance" for reproductions [S4].
  - Say that instead: **"Hand-picked vendors. No reproductions."** No competitor reviewed here leads with it (§5), so it is RRG's most distinctive attendee point.
- **Other points worth adding, each sourced:**
  - something to do besides shopping: free play, tournaments and trivia [S2];
  - local roots: Triangle-based since 2018 [S2];
  - some free events: the Halloween Market is listed as Free with RSVP [S1][S7];
  - the Extra Life cause, which already has its own band lower on the page [S1].
- **The Hero section has no bullet field.** It takes a heading (max 120), a subheading (max 300) and up to two buttons ([R1], [R2]). Selling points therefore go in one of two places: one subheading line, or a `FeatureGrid` / `Stats` section directly under the hero ([R3], [R4]).
- **Best option (A):**
  - Headline: **"Find the games you grew up with"**
  - Subhead: **"Pop-up markets, expos and esports across the Triangle. Hand-picked vendors, no reproductions."**
  - Buttons: **See upcoming events** (primary) and **Become a vendor** (secondary).

---

## 2. Current hero (live, 2026-10-07)

Quoted exactly from `/` [S1]:

> **Sell where the gamers are**
> Thousands of collectors, retro fans and families pack our markets ready to buy. Bring your games, collectibles and geek gear, and grow your sales at Raleigh's favorite nostalgia events.
> [Become a vendor]

**Layout:**

- The hero is `Hero-become-a-vendor`: `textStyle: retro`, `alignment: left`, `mobileLayout: button-bottom`, full-bleed video, `height: screen`. Sources: memory `project_hero_mobile_layout.md` and the vault note above.
- Since PR #334 the header overlays the hero (memory `project_storefront_header_uniform.md`).
- Retro style renders the heading in uppercase monospace, `text-4xl` on phones ([R2], `HeroSection.tsx` lines 128–131).

**What the layout means for copy length:**

- **Headline.** About 5 words, or 32 characters, keeps it to two or three lines on a 390 px phone. Monospace capitals run wide. This is an estimate from the font size and has not been measured.
- **Subhead.** About 140 characters at most. With `button-bottom`, the text sits above two full-width stacked buttons pinned near the bottom ([R2] lines 124 and 137–140), so a long subhead pushes the heading up under the overlaid header.

---

## 3. Audience split

| Audience | Where they are served today | What they need from the home hero |
|---|---|---|
| Attendees: collectors, retro fans, families | Home Upcoming events, `/events`, event pages [S1][S7] | What is it, where, when, why go, whether it costs money |
| Vendors | `/pages/vendors`, `/pages/vendor-faq`, Vendors menu dropdown [S3][S4] | Audience size, cost, how to apply |
| Sponsors | `/pages/sponsors` [S5] | Reach, tiers |

**Two problems with the current hero.**

- Vendors and sponsors already have three dedicated landing pages, linked from the main menu [S1].
- The home page's own content below the hero speaks to attendees: the welcome text, Upcoming events with RSVP and ticket buttons, and Extra Life [S1]. The vendor-first hero clashes with it.

Both points argue for an attendee-first hero, with "Become a vendor" kept as the secondary button so vendors are not lost.

**If the owner wants the hero to stay vendor-facing**, which is a valid choice when vendor recruitment is the business goal right now, use option C (§6).

**What each drafted point speaks to:**

- **"Diverse vendor network":** vendor- and sponsor-facing in tone. Its attendee version is "hand-picked vendors".
- **"Live market events":** neutral, but too vague to pull anyone in.

---

## 4. Proof points available (sourced)

Message architecture per the brand skill: each supporting message needs a proof point.

| Candidate selling point | Audience | Proof (source) | Use in hero? |
|---|---|---|---|
| Pop-up markets, expos and esports in Raleigh and around the Triangle | Attendee | "We produce gaming and geek-related expos, pop-up markets, retro-inspired events, and esports in Raleigh and surrounding areas" [S1][S8] | **Yes.** This replaces "Live market events" |
| Hand-picked vendors, no reproductions | Attendee | Selective application; "true experts"; "working and complete condition"; "zero-tolerance policy for reproduction or counterfeit items… 'proxy' Pokémon cards"; offenders "barred from all future events"; "shop with confidence" [S4] | **Yes.** This replaces "Diverse vendor network" |
| Variety: gaming first, plus geek vendors, little overlap | Attendee | "We strive to offer a variety of vendors at each market… prioritize gaming vendors"; "ensuring we don't have too much overlap in offerings" [S4]; vendor type list (games, consoles, TCG, toys, comics, art, food trucks) [S3] | As body detail: "games, consoles, cards, toys and comics" |
| More than shopping: free play, tournaments, trivia, esports | Attendee | "Free play, tournaments, trivia and more"; "Players compete while the crowd cheers them on" [S2] | Yes, as a bullet |
| Local and established | Both | "founded in 2018"; "Founded in the Triangle"; "Proudly rooted in North Carolina" [S2] | Yes, short ("Since 2018") |
| Big, engaged community | Both | "a thriving community of thousands across North Carolina" [S2] | Yes, but only as "thousands" |
| 25,000+ attendees a year; "#1 / largest gaming event company in North Carolina" | Vendor | Vendors page Stats (self-reported, unverified) [S3]. It conflicts in scale with the About page's "thousands" [S2] | **Not in the attendee hero.** "Largest in NC" is a superlative claim; confirm with the owner before using it anywhere attendee-facing |
| Free events | Attendee | Halloween Market (Oct 24, Triangle Town Center) listed "Free · RSVP" [S1][S7] | Only per event (the CTA or the announcement bar). The expo is paid, $20–$65 [S1], so never say "free events" globally |
| Family-friendly | Attendee | "gamers of all ages" [S2]; "collectors, retro fans and families" [S1] | Yes |
| Gives back (Extra Life, Children's Miracle Network Hospitals) | Attendee | Home Spotlight band [S1] | No. It already has its own band, so keep it out of the hero |
| Venues: malls, museums, parks | Attendee | "pop-up activations at malls, shopping centers, museums, City Parks" [S3] | Optional body detail |

**Facts not found anywhere:** total vendor count per event, number of events per year, attendee counts per event. None are published, so do not invent them. If the owner can supply them, a numbers strip such as "80+ vendors" would be the strongest proof (§7).

---

## 5. What comparable events lead with (light check)

| Event | Leads with | Source |
|---|---|---|
| TooManyGames (PA) | "The Ultimate Gaming Convention"; date + venue; "retro and modern gaming, tournaments, panels, guests, vendors"; "Whether you're a longtime fan or brand new"; counts (gamers, states, years, est. 2004) | [E1] |
| Game On Expo (AZ) | "The Southwest's Premier Gaming, Anime, & Nostalgia Experience!"; category list; date + venue; award ("Best Geek Convention"); "10+ Years"; "compete, collect, cosplay, or connect" | [E2] |
| Southern-Fried Gaming Expo (GA) | Date + venue; concrete counts ("more than 400 arcade & pinball machines"); activity list; "Game all weekend" | [E3] |
| Portland Retro Gaming Expo (OR) | "Classic Video Game Convention", Portland; nav-heavy attractions list (tournaments, auctions, museum, VHS swap) | [E4] |

**Patterns:**

1. They name the category plus the place ("gaming convention, Philadelphia").
2. They list activities as verbs, such as compete, collect and play.
3. They give one hard proof: years running, an award, or machine count.
4. They put date and venue next to the headline.

**What none of them leads with:** buyer protection or vendor vetting. RRG's no-reproduction policy [S4] is a differentiator that matters to collectors, who know repro carts and proxy cards are a real risk. That is the reason to promote it to the hero.

None of them says "vendor network" in its attendee hero. Vendors appear only as one item in the activity list ("vendors", "vendor expo").

---

## 6. Hero copy options

Every option fits the live Hero schema: a heading of 120 characters or fewer, a subheading of 300 or fewer, and at most two buttons ([R1]). The **selling points** are written for a 3–4 item `FeatureGrid` placed directly under the hero (Feature title max 80, text max 300 [R3]). If you want everything inside the hero, fold the first two points into the subhead, as each option's subhead already does.

### Option A — attendee first, nostalgia (recommended)

- **Headline:** Find the games you grew up with *(31 characters)*
- **Subhead:** Pop-up markets, expos and esports across the Triangle. Hand-picked vendors, no reproductions. *(93 characters)*
- **Selling points:**
  1. **Retro and modern, under one roof.** Games, consoles, cards, toys, comics and art from gaming and geek vendors. [S3][S4]
  2. **Shop with confidence.** Every vendor is reviewed. Working, complete items only, and zero tolerance for reproductions. [S4]
  3. **Come to play, not just shop.** Free play, tournaments, trivia and esports. [S2]
  4. **Local since 2018.** Thousands of Triangle gamers of all ages. [S2]
- **CTAs:** primary **See upcoming events** (link EVENTS); secondary **Become a vendor** (Vendors page).

**Why it ranks first.**

- It passes the portability test: "no reproductions" and "the Triangle" cannot be moved to another company unchanged.
- It is credible, because every line is sourced.
- It matches the attendee content below the hero.
- It keeps the vendor path one tap away.

### Option B — place and people, both audiences

- **Headline:** Where the Triangle's gamers meet *(32 characters)*
- **Subhead:** Retro game markets, expos and esports in Raleigh since 2018. Come to shop and play, or bring your table and sell. *(115 characters)*
- **Selling points:**
  1. **Pop-up markets and expos** at malls, museums and parks across Raleigh-Durham. [S3]
  2. **Hand-picked vendors.** Gaming first, plus comics, cards, toys and art, with little overlap. [S4]
  3. **Play while you're here.** Free play, tournaments and trivia. [S2]
  4. **Gamers of all ages.** Bring the family. [S1][S2]
- **CTAs:** **Find an event** / **Sell with us**

**Trade-off.** The headline is warmer and serves both audiences, but it says less about what happens at the events than option A.

### Option C — keep it vendor-facing (if recruitment is the goal)

- **Headline:** Sell where the gamers are *(the live headline; keep it, it is strong)* [S1]
- **Subhead:** Thousands of collectors, retro fans and families come to our markets ready to buy. Applying is free. *(about 100 characters; trimmed from the live copy, with "Applying is free" from [S4])*
- **Selling points:**
  1. **A crowd that came to buy.** Collectors and retro fans, reached through our email list, social, local news and paid ads across NC. [S4]
  2. **Free to apply.** Spaces typically $75–$150, and some events are free to vend. [S4]
  3. **Markets and expos year-round.** Indoor and outdoor events across the Triangle. [S3]
  4. **A curated floor.** No reproductions, and limited overlap between vendors. [S4]
- **CTAs:** **Apply to vend** / **Read the vendor FAQ**

**Caveats.**

- If option C is used, "25,000+ attendees a year" [S3] is the obvious stat. It is self-reported and inconsistent with the About page's "thousands" [S2], so confirm it with the owner first.
- This option duplicates `/pages/vendors`, which already makes the same case [S3].

### Applying the two drafted points if the owner wants to keep them

| Draft | Problem | Rewrite |
|---|---|---|
| Live market events | "Live" is filler. "Market events" is generic and leaves out expos and esports | **Pop-up markets, expos and esports** (attendee) / **Markets and expos year-round** (vendor) |
| Diverse vendor network | B2B tone ("network"). "Diverse" is vague and open to misreading. Attendees do not buy a network | **Hand-picked vendors, no reproductions** (attendee) / **A curated floor, little overlap** (vendor) |

---

## 7. Open questions for the owner

1. **Audience.** Should the home hero sell to attendees (A/B) or keep recruiting vendors (C)?
2. **Attendance figures.** Is 25,000+ a year [S3] a counted figure? Can a per-event number be published (vendor count, attendance)? That is the one proof the comparable expos have and RRG's home page lacks.
3. **"Largest gaming event company in North Carolina" [S3].** What is it based on? It is a superlative claim, so keep it off the home page until it is sourced.
4. **Free markets.** Are free-entry markets the norm (only the Halloween Market is verified [S7])? If they are, "Free markets, every season" becomes a strong attendee point.
5. **Brand guide.** A short RRG voice guide would make future copy faster. Draft it from the brand skill's `templates/brand-guidelines-starter.md`, filled with the proof points in §4.

---

## Sources

**RRG live storefront** (`https://frontend-production-43e9.up.railway.app`, fetched 2026-10-07)

- [S1] `/` home: hero, welcome text, Upcoming events, Extra Life band, menu
- [S2] `/organizations/raleigh-retro-gamers/pages/about`
- [S3] `/organizations/raleigh-retro-gamers/pages/vendors`
- [S4] `/organizations/raleigh-retro-gamers/pages/vendor-faq`
- [S5] `/organizations/raleigh-retro-gamers/pages/sponsors`
- [S6] `/organizations/raleigh-retro-gamers/pages/contact`
- [S7] `/organizations/raleigh-retro-gamers/events`

**RRG legacy site**

- [S8] https://raleighretrogamers.com/, home page text (fetched 2026-10-07)

**Jump code** (origin/main `bacd723`)

- [R1] `packages/theme/src/registry.js` lines 211–237: Hero settings and `blocks: buttons`
- [R2] `frontend/src/theme/sections/HeroSection.tsx`: header comment "up to two buttons" (line 3), retro heading (128–131), button-bottom layout (124, 137–140)
- [R3] `packages/theme/src/registry.js` lines 92–99 and 349–360: Feature and FeatureGrid
- [R4] `packages/theme/src/registry.js` lines 100–106 and 362–371: Stat and Stats

**Comparable events** (fetched 2026-10-07)

- [E1] https://www.toomanygames.com/
- [E2] https://gameonexpo.com/
- [E3] https://www.southernfriedgamingexpo.com/
- [E4] https://www.retrogamingexpo.com/
- Let's Play Gaming Expo (403) and Retro Game Con (empty response) could not be fetched.

**Skills**

- `.claude/skills/brand/references/messaging-framework.md`
- `.claude/skills/brand/references/voice-framework.md`
- `~/.claude/skills/no-ai-slop/SKILL.md`
