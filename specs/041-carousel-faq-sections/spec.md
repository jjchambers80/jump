# Spec 041 — Hero carousel and FAQ theme sections

**Status:** Implemented (2026-09-30)
**Builds on:** [038 theme editor](../038-theme-editor/plan.md), [contracts C12](../038-theme-editor/contracts.md)

## Goal

Organizers can only place a single-image **Hero** banner on the storefront. They want a rotating banner (several slides, each with its own image, text and button) and an FAQ accordion. Both are new theme sections in the existing registry: no new field kinds, no schema version bump, no new routes. Existing themes render exactly as before; organizers add the sections from **Add section** in the theme editor.

## Sections

| Section | Category | Settings | Blocks |
|---|---|---|---|
| `HeroCarousel` "Hero carousel" | Banners | autoplay off / 5s / 8s (5s), height, overlay opacity, show arrows, show dots, common (scheme, padding) | `Slide` × 1–6 |
| `Faq` "FAQ" | Text | heading, intro, one answer open at a time (on), open the first answer (off), width, common | `FaqItem` × 1–30 |

| Block | Settings |
|---|---|
| `Slide` | image (alt text or decorative), heading, subheading, button label, button link, text alignment |
| `FaqItem` "Question" | question (≤ 200), answer (rich text ≤ 4000, sanitised on write) |

Storefront wording (theme content, translatable per theme): `carousel.label`, `carousel.previous`, `carousel.next`, `carousel.pause`, `carousel.slide` ("Slide {n} of {total}").

## Decisions

1. **Slot blocks, not array fields.** Slides and questions are Puck slot blocks like `Button` in `Hero`: selectable on the canvas, fields generated from the registry (image picker, link picker, rich text all existed). Announcement bar and footer columns stay array fields.
2. **A slide's button is two fields on the slide** (`buttonLabel`, `link`), because theme blocks cannot hold blocks (validator depth ≤ 2).
3. **Carousel = CSS scroll-snap track + client island.** The slot wrapper is the track, so slides swipe and scroll with no JavaScript and every slide stays reachable in the editor. `HeroCarouselFrame` adds arrows, dots, keyboard arrows and rotation. Rotation has a pause button (WCAG 2.2.2), holds while the pointer is over the carousel or focus is on a slide, never starts under `prefers-reduced-motion`, and is off inside the editor.
4. **FAQ = native `<details>/<summary>`.** Works without JavaScript and is accessible by default. "One at a time" is the exclusive-accordion `name` attribute, set by the `FaqBehavior` island because slot children cannot receive props from their section; browsers without it simply allow several open. No FAQPage JSON-LD (Google restricted FAQ rich results in 2023).
5. **Empty sections do not render.** The render endpoint drops a `HeroCarousel` or `Faq` whose blocks are all hidden, like an announcement bar with nothing to announce (`ThemeService._visible`, `BLOCKS_ONLY`).
6. **Default preset unchanged.** `Hero` stays the starter banner; freshly added carousels and FAQs start with two example blocks (`STARTER_BLOCKS` in `theme/editor/config.tsx`).

## Out of scope

FAQPage structured data; per-slide scheduling (show from / until, like announcements); video slides.
