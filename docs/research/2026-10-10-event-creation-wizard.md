---
type: research
title: Event creation wizard — Zeffy-style step flow for Create Event
status: reference
created: 2026-10-10
updated: 2026-10-10
project: jump
tags: [jump, research, events, wizard, onboarding, draft-publish, applications, ux, competitor, zeffy]
source: Zeffy event editor screenshots /Users/jj/Downloads/Event/*.png (23 files, captured 2026-10-10); support.zeffy.com event articles (see Sources); Jump code at origin/main 19c65b2
---

# Event creation wizard: research for Jump

**Question.** Replace the current **Create event** page with a Zeffy-style step wizard. Every "Create Event" click starts the wizard. Events have Draft and Published states. Three Jump-only steps each get their own step: **vendor application**, **special guest application** and **volunteer application**. This note gives the planner the Zeffy inventory, Jump's current state, a gap matrix, a draft step list, a reuse list and the gotchas.

**About the citations.** Jump `path:line` citations point to `origin/main` at `19c65b2` (2026-10-10, PR #395). The local checkout is detached at an older commit (`3240a3c`), so read them with `git show origin/main:<path>`. Screenshots are cited by their filename in `/Users/jj/Downloads/Event/`. Copies are in the vault as `10_Personal/70_Assets/jump--zeffy-event-wizard--<NN-step>.png`. External claims carry a bracketed number that points to the Sources list. When this note and a source disagree, the source wins.

**Decided by the owner (2026-10-10).** The wizard starts directly at event setup, with **no campaign-type chooser** (Zeffy's step 0, `1.png`). Jump has no raffle or "other sales" products. Ticketed vs RSVP is chosen inside event setup through `admissionMode`, not in a chooser. A donation campaign type comes later with spec 047, and a step 0 can be added in front of the event steps then without changing them. The event wizard does get a Zeffy-style **Collect more** step: add-ons plus an "Allow additional donations at checkout" toggle that depends on spec 047 D1 (§5.1, step 7).

---

## 1. TL;DR

- **Draft and Published already exist.** `Event.status` is `DRAFT | PUBLISHED | CANCELLED` and defaults to `DRAFT` (`schema.prisma:943`, `:1386-1390`). `POST …/publish` moves DRAFT → PUBLISHED and requires at least one active tier on ticketed events (`EventService.js:398-442`). What is missing: an **unpublish** action (cancel accepts only PUBLISHED events, `EventService.js:462`), any **partial draft**, a **resume** point, and a **draft preview**. Today "View page" on a draft opens a 404, because the public read returns PUBLISHED events only (`EventService.js:580`, `admin/events/[eventId]/page.tsx:159-167`).
- **The biggest structural blocker is that you cannot save a partial draft today.** Create requires a venue, a future date, capacity and at least one tier with quantity ≥ 1 (`eventValidators.js:27-55`, `EventService.js:54-92`). An event has no `organizationId` of its own: it belongs to an org through Venue → Organization (`schema.prisma:930-953`). So a draft can exist on the server only once it has a venue. A Zeffy-style "Save & exit" after the title step needs either client-held state until the venue step, or a schema change.
- **None of the three Jump-only form kinds exists as a kind.** `ApplicationFormKind` is only `PAID | FREE` (`schema.prisma:1547-1550`), and a form's role is guessed from its name with a regex (`GetInvolved.tsx:16-22`). That regex knows "volunteer" but has no pattern for "special guest", so those links fall back to "Apply". Event forms **must** collect business details (`ApplicationFormService.js:223`), which is wrong for volunteers and many guests. Standing forms already allow turning it off (spec 044).
- **Verdicts.** Adopt Zeffy's chrome: progress bar, Save & exit, Back / Next / Skip for now, a live preview with a phone/desktop toggle, and the completion screen. Adopt the basics, tickets and add-ons steps. Skip Zeffy's per-event **font, color, mode, background and logo** steps. In Jump these are org brand and theme settings: `BrandScope` gotchas 6/7, and spec 049 puts typography in the theme. Adopt **Collect more** (add-ons, plus a donation toggle that stays hidden until spec 047 D1 ships and the org is a verified nonprofit on Stripe Connect). Defer **discount codes** (gap analysis T1), **attendee questions**, **reminders** and **multiple dates** (T12). Add Jump's own steps: **Venue**, **Vendor applications**, **Special guests**, **Volunteers** and an optional **Floor map**.
- **Proposed order (draft):** Title → Venue → Date & time → Description → Image → Tickets or RSVP → Collect more → Vendor applications → Special guests → Volunteers → Floor map (only when a vendor form exists) → Review & publish → Done. Venue comes **before** the date because the date is typed in the venue's wall clock (spec 033, `new/page.tsx:97-99`, `:472-477`).

---

## 2. Zeffy wizard UX inventory (question A)

### 2.1 Chrome and behavior

| Aspect | What Zeffy does | Evidence |
|---|---|---|
| Step 0 | "What campaign do you want to create?" offers Event, Donation, Raffle, Online shop, Membership, Auction, Peer-to-peer and Other sales ("sponsorships, vendor booths, program fees"). A sample-campaign preview sits on the right, with Exit and "Create event campaign" buttons. **Not adopted** (owner decision, see the header) | `1.png` |
| Header | Zeffy logo, a thin **progress bar** across the full width, and a top-right **Exit** on the title step that becomes **Save & exit** from the dates step on | `2.png` (Exit), `3.png`+ (Save & exit) |
| Draft creation | The switch from "Exit" to "Save & exit" after the title suggests the campaign is created as a draft once the title is set (inference). Zeffy: "If the Share button is greyed out, your campaign is still in Draft mode"; "Every Zeffy campaign is automatically published and ready to share once you finish creating it" [3] | `2.png` vs `3.png`; [3] |
| Layout | Left: a form pane with a big heading ("Title your event", "Set date(s) for your event"…), one grey card per field group, and a trash icon on removable groups. Right: a dotted canvas with a **phone mockup**, a phone ↔ desktop toggle at the top, and a chat bubble | every step |
| Live preview | The preview updates as you type. Fields not set yet show as faded placeholders ("123 Street Name, City, State", "$ -", "General Admission"). An **arrow (→)** points at the section being edited, and the phone **scrolls to that section**. Tickets puts the tier cards at the top; Discount codes and Attendee info switch to the checkout **Summary** screen; Add-ons switches to the "Want to add anything else?" screen | `3.png`, `5.png` (arrow at address), `11.png`, `14.png`, `15.png`, `17.png` |
| Preview swaps | E-ticket swaps the phone for a full **ticket preview** (QR with "Guest checked in", N°1, 1/1 tickets, buyer info, refund fine print). Communications swaps it for a full **email preview** | `19.png`, `20.png` |
| Footer | **Back** on the left. On the right, **Next**, or **Skip for now** when the step is empty and optional (dates, logo, attendee info, discount codes). The title step has "Back to choices" | `4.png`, `10.png`, `14.png`, `17.png`, `2.png` |
| Mobile | The header becomes **☰** (step menu), **👁** (preview) and **Save & exit**. The form is one column and the preview sits behind the eye icon | `1-mobile-layout-example.png` |
| Completion | "Congrats! Your event is ready." with three cards: View my campaign, Share my campaign, and Set up event communications ("Send smart invites, automate thank-you messages, and more"). The preview stays visible, with a "How easy was it to create your campaign?" 5-point survey. A `→|` control sits top-left, purpose not visible (probably opens the step menu or editor) | `22.png`, `1-mobile-layout-example.png` |

### 2.2 Steps in order

**Order note.** The progress bar's fill puts **Style before Banner**: Style at about 686 px (`9.png`), Banner at about 823 px (`8.png`), Logo at about 960 px (`10.png`). The screenshot file numbers, and the vault names `05-banner` / `06-style`, have them the other way round. The fill widths, in step order: Title 137, Dates 274, Address 410, Description 549, Style 686, Banner 823, Logo 960, Tickets 1097, Collect more 1152, Attendee info 1280, Discounts 1408, E-ticket 1536, Communications 1664, Advanced 1792 (px of 1920).

| # | Step | Fields and behavior | Skip rule | Evidence |
|---|---|---|---|---|
| 1 | **Title your event** | Title (prefilled "Annual Gala") plus **Font style**: Classic, Bubbly, Elegant, Slab serif, Futuristic, Handwritten. "The title assigned to the event will inform the title in the URL string which cannot be changed or edited after the campaign has been created" [1] | Required | `2.png`; [1] |
| 2 | **Set date(s)** | "You can choose one, multiple or no dates." Event date card: Start*, End*, **Event recurrence** ("Occurs once"; daily, weekly or monthly [1][4]), "+ Add sales open and/or close date" (opening: "If empty, sales open on campaign creation"; closing: "If empty, sales close when the event ends"), a tip that per-ticket availability lives in Tickets, and "+ Add another date". Empty state: "+ Add a date". Tickets are not tied to a date: "The tickets you configure will be available every day that your event takes place" [4] | Optional ("Skip for now" when empty). With no date set, no reminder can be configured [5] | `3.png`, `4.png`, `6.png`; [1][4][5] |
| 3 | **Set the address** | One autocomplete field. "If this is a virtual event, simply don't add an address" | Optional (Next is always shown) | `5.png` |
| 4 | **Tell us more** | A rich-text description (bold, italic, underline, size, link, image, special characters, undo/redo). The preview shows a clamped excerpt with "More details ↗" | Optional | `7.png` |
| 5 | **Style your campaign** | Ten color swatches (including black/white and a gradient "auto"), Light or Dark mode, and a background style (Simple, Animated, Static shapes) | Has defaults | `9.png` |
| 6 | **Add a banner** | Image **or** video (a YouTube URL; Shorts are not supported [1]), with Replace and Delete | Optional | `8.png`; [1] |
| 7 | **Upload your logo** | "For best results, choose a square logo." Shown top left on the form [1] | "Skip for now" | `10.png`; [1] |
| 8 | **Add tickets** | **Global event capacity** (total tickets, "Unlimited" placeholder, "0 total tickets sold" chip). Per ticket: drag handle, number + title, "0 sold" chip, duplicate, delete, Title*, Price*, Description. A collapsible **Ticket options** panel: *Capacity & availability* (Total available "Unlimited", Min / Max purchase quantity, max default 10), the **Schedule ticket availability** toggle ("early bird, at the door"), *Ticket type* (Pay what you can, Group ticket, Category(ies)), and *Taxes and receipts* (Issue tax receipt, Tax at checkout). "+ Add another ticket type". The docs also list a **Members-only rate** [1] | At least one ticket | `11.png`; [1][6] |
| 9 | **Collect more** | *Additional donations*: Allow additional donations, plus Generate a tax receipt for it. *Add-ons* ("drinks, parking slots"): Image, Add-on title*, Price*, Description, a collapsible "Add-on options", duplicate and delete | Optional | `12.png`, `15.png` |
| 10 | **Collect attendee info** | Two sections. **Per attendee** ("filled by each attendee") and **Buyer only** ("filled once by purchaser"; defaults: First, last name*, Email*, Country & State*). The add modal has Per attendee / Buyer only tabs, "Create from scratch", or presets (Full address, First/last name, Email, Phone). Docs: single select, multiple choice, checkbox and name formats, per-ticket-type targeting, required, and a "maximum choice limit" [1] | "Skip for now" | `13.png`, `14.png`, `16.png`; [1] |
| 11 | **Discount codes** | Code*, Value*, Type ($ / %), Max # of uses (Unlimited), Apply discount ("Only once per order"), and "+ Add another discount code". Multi-date events add "Uses limit per date" [1]. The preview shows the Summary's discount code box | "Skip for now" | `17.png`, `18.png`; [1] |
| 12 | **Customize your e-ticket** | **Issue e-tickets** toggle (on by default) and **Ticket banner** (Replace / Delete). Live ticket preview | Has defaults | `19.png`; [1] |
| 13 | **Automated communications** | **Thank you email** ("Following purchase"; the toggle looks locked on, and the docs say it cannot be disabled [1][7]), **Reminder 1** (7 days before the event), **Reminder 2** (1 day before), each with a toggle and a "customize" chevron. Live email preview: order, View tickets, Download tax receipt, Apple/Google Wallet, the custom message with a `First name` variable, event details, Add to calendar, receipt. Each reminder "will only be sent out once"; variables are First name, Last name, E-ticket and Date [5]. The thank-you email "automatically adapts to your organization's brand colour" [7] | Has defaults | `20.png`; [1][5][7] |
| 14 | **Advanced settings** | Collaborators ("2 collaborators have access", Manage collaborators), *Finance*: Offer payment by check, Assign non-eligible sales to a fund. *Display*: Campaign target thermometer. *Regional*: **Timezone** select, plus Translate my campaign to Spanish. In Zeffy the time zone sets the zone on e-tickets and emails, while the public form "adjust[s] to the time zone of each visitor's device" [8] | Has defaults | `21.png`; [1][8] |
| 15 | **Congrats! Your event is ready.** | View, Share, Set up event communications, plus the survey. The campaign is published at this point [3] | — | `22.png`; [3] |

---

### 2.3 After the wizard: campaign dashboard and edit mode

Owner-supplied screenshots, 2026-10-10. They are stored in the vault as `/Users/jj/Brain/Brain/10_Personal/70_Assets/jump--zeffy-event-wizard--16a…17*.png`.

- **Campaign dashboard** (`16a-dashboard-overview.png`). Header: title, date, then **View**, **Edit**, and a **⋯** menu. Four tabs: **Overview**, **Payments**, **Guest list**, **Communications**. Overview shows:
  - an "invite your supporters" email banner;
  - Sales overview tiles: Total raised (+ Add offline payment), Guests (+ View guest list), Additional donations, Total saved on Zeffy;
  - a Ticket breakdown table (Sold / Canceled / Refunded / Net raised, plus a total row, "See full data");
  - Campaign activity donuts: payments by device and by method.
- **Payments tab** (`16b-dashboard-payments.png`). Search, date range, a status filter and a More filter. **Add payment ▾** offers **Offline payment**. Empty state: "send an email invite".
- **Guest list tab + ⋯ menu** (`16c-dashboard-guest-list-menu.png`). An attendance donut (checked in / not checked in), **Add guest**, Create an invite. The ⋯ menu holds Share, View campaign, Edit, **Clone**, **Close sales** (with an info tip), **End campaign** (disabled here) and **Delete campaign**.
- **Communications tab** (`16d-dashboard-communications.png`). Suggested templates (Empty email, Invitation, Thank you), Designed / Simple / Automated filters, New email. The wizard's three automated emails appear as rows: the two reminders are *Scheduled* with a send time, the thank-you is *Active*. Each row has Status, Recipients, Date, Purchases and Open rate.
- **Edit = the same wizard, non-linear** (`17-edit-jump-to-step.png`). Edit reopens the wizard. A **"Jump to edit…"** side panel lists every step (Title … Advanced settings, **Review**), so any step can be opened directly. The top bar becomes **Save & share** + **Save & exit**. The live preview stays on screen. The panel calls the add-ons step "Add-ons" and the attendee step "Questions", and adds a **Review** step that the create flow screenshots don't show.

**Jump mapping**
- The dashboard is Jump's spec 037 event workspace. Jump's tabs are Overview, Applications, Map, Attendees (RSVP: Guest list), Analytics, Door check-in, History (`frontend/src/components/events/EventWorkspace.tsx:30`, `:55-69`). Jump already covers more than Zeffy; the gaps are a per-event Payments tab, which spec 024 deliberately forbids (`/admin/orders` is the one money surface, gotcha 17, so link to Orders filtered by event instead), a per-event Communications tab (Jump has no email campaigns), offline payments, and Close sales separate from Cancel.
- The ⋯ menu maps to Jump's existing Duplicate (Clone) and Cancel. **Close sales** (stop selling, stay published) and **Delete** of an unsold draft are worth comparing with Jump's actions in planning.
- **Edit mode is the important finding.** Zeffy has one editing surface: the wizard, run non-linearly. Section 5.2 recommended keeping Jump's section editors for existing events. The owner now has to choose (decision 15).

## 3. Jump today (question B)

### 3.1 How an event is created

- **Entry points.** The events list header (`EventsPageHeader.tsx:61`) and the venue Details page (`admin/venues/[venueId]/page.tsx:371`) both link to `/admin/events/new`.
- **Page.** `/admin/events/new` (`frontend/src/app/admin/events/new/page.tsx`, 546 lines) is a single page with two columns (`EventFormShell`) and no steps.
  - **Main column.** Event Details holds Name*, `SlugField` and Description (`RichTextEditorField`, `:330-366`). Then come `EventMediaCard` (`:368-374`) and Price Tiers for ticketed events (`TierCard` + `TierEditDialog`, saved tiers through `TierHeaderActions`, `:376-423`).
  - **Aside.** The save card, then Date & Venue (Venue* select with "+ Add new venue…" → `VenueFlyout`, Date & Time* as `datetime-local` in the venue zone, `:430-481`), Admission (`AdmissionModeField`; Capacity* 1–100,000 or `RsvpSettingsFields`, `:484-519`) and Listing (Category, `:521-532`).
- **One request.** Submit posts the whole event plus its tiers in one `POST /organizations/:orgId/events` (`new/page.tsx:277`). The image is held in memory and uploaded right after the create through `POST …/events/:id/logo` (`:119-130`, `:278-288`). The page then redirects to `/admin/events`, the list, not the new event (`:289`).
- **Required fields** (`eventValidators.js:27-55`): `venueId`, `name` (≤ 255), `date`, and for TICKETED events `capacity` (1–100,000) plus **at least one tier**, each with a name, price ≥ 0 and `quantityTotal` ≥ 1. The service also checks that the venue belongs to the org, that the date is in the future, and that tier quantities add up to no more than capacity (`EventService.js:54-92`). It creates the event as `DRAFT` (`:114`). The client blocks submit until a venue is chosen (`new/page.tsx:302`).
- **Access.** Event create, update and publish need `requireOrganizer` (`routes/events.js:143`, `:157`, `:193`). Add-ons and application forms need **ADMIN** (`addOns.js:15`, `:40`; `admin.js:784`; `rbac.js:33-36`).
- **After create.** Spec 037 makes `/admin/events/[eventId]` the read-only Details page, with section editors at `/edit/details` and `/edit/sales` plus flyouts for small edits (`docs/wiki/features/event-details.md:32-43`; spec 037 D10, `plan.md:70`). Both editors are one `EventEditor` component with a `scope` (`edit/EventEditor.tsx:198`). The editor has a dirty snapshot and a `beforeunload` guard (`event-editor.md:43-46`).

### 3.2 Draft and Published today

| | State |
|---|---|
| Enum | `EventStatus { DRAFT PUBLISHED CANCELLED }`, default `DRAFT` (`schema.prisma:943`, `:1386-1390`) |
| Publish | `POST /organizations/:orgId/events/:eventId/publish` (`routes/events.js:193`). DRAFT only, and a ticketed event needs ≥ 1 active tier (`EventService.js:410-420`). It refreshes the tax rate (`:432`). The UI is the Publish button on the Details hero (`admin/events/[eventId]/page.tsx:169-177`) and on the list card (`EventListCard.tsx:325-332`) |
| Cancel | PUBLISHED → CANCELLED only (`EventService.js:462`). RSVP holders are notified (`:468+`) |
| Unpublish | **Missing.** There is no PUBLISHED → DRAFT transition |
| Public visibility | Only PUBLISHED events are readable publicly (`EventService.js:580`, `:597`). Public application forms 404 unless the event is PUBLISHED (`ApplicationService.js:334`). RSVPs are refused unless PUBLISHED (`RsvpService.js:59`) |
| Draft preview | **Missing.** "View page" on a draft links to the public path and gets a 404 (`admin/events/[eventId]/page.tsx:159-167`). The closest pattern is the theme draft preview link: a signed URL with a 1 h staff or 14 d share lifetime (`ThemePreviewService.js:21-36`, `routes/themes.js:105`) |
| Drafts surfaced | The dashboard "attention" list counts upcoming drafts (`DashboardService.js:102`). The events list has status counts (`EventService.js:755`) |
| Autosave / partial save | **None on events.** Create is all-or-nothing. The edit page saves on demand. Add-ons and media save on their own (`event-editor.md:46`). The map builder is the only autosave in admin (`frontend/AGENTS.md:52`) |
| Venue first? | **Yes.** `venueId` is required (`eventValidators.js:30`), and org scoping depends on it, since `Event` has no `organizationId` (`schema.prisma:930-953`; root `AGENTS.md` "Org scoping"). There are no virtual events |
| Dates | **One start instant** (`Event.date`, `schema.prisma:940`). No end time, no doors time, no multiple dates, no recurrence (gap analysis T12, `2026-10-10-industry-gap-analysis.md:230-235`). Sale windows exist per tier only (`PriceTier.saleStartDate/saleEndDate`, `schema.prisma:1011-1012`) |

### 3.3 Applications attached to events

- **Model.** `ApplicationForm` has `eventId String?`: a null event means a standing form (spec 044). It also has `kind PAID|FREE`, `status DRAFT|OPEN|CLOSED`, `opensAt/closesAt`, `collectBusiness`, `spaceSelection TIERS|MAP` and `reserveOnApproval` (`schema.prisma:1737-1777`, `:1560-1564`). Its tiers are `ApplicationTier` (vendor categories, spec 037 D4) and its questions are `ApplicationQuestion` with 10 `QuestionType`s (`:1779-1821`, `:1625-1636`). Templates are `ApplicationFormTemplate` JSON snapshots (`:1967-1982`).
- **Create.** `POST /admin/events/:eventId/application-forms` is ADMIN only (`admin.js:784`) and goes to `ApplicationFormService.createForm`. It accepts an optional `templateId`, which must be of the same kind (`ApplicationFormService.js:220-235`). On the admin side, the event's Applications › Forms tab has a Kind select ("Free (press, panels, creators)" / "Paid with options (vendors, sponsors)") and a "Start from" template picker (`applications/forms/page.tsx:115-171`). The form editor is built from `SettingsCard`, `TiersCard` and `QuestionsCard` (`components/applications/FormEditorCards.tsx:68`, `:328`, `:524`).
- **Purpose / role.** Not stored anywhere. The storefront "Get involved" pills guess it from the form name: vendor/exhibit/booth/merchant/artist → "Become a vendor", sponsor, press/media, panel/speaker/talk, and volunteer → "Volunteer". Anything else gets "Apply" (`GetInvolved.tsx:16-26`).
- **Special guest.** Does not exist. The spec 019 vocabulary lists "celebrity guests" as participants (`specs/019-participants/spec.md:11`). There is no regex for it, so the pill reads "Apply".
- **Volunteer.** Exists only as words: copy on the standing-forms pages (`admin/content/forms/page.tsx:128`, `[formId]/page.tsx:219`) and the pill regex. **Event forms refuse `collectBusiness: false`** (`ApplicationFormService.js:223`), so an event volunteer form today has to ask for business name, website and photos. Only standing forms can turn that off (spec 044 §2, `plan.md:25-37`). Shifts and roles do not exist.
- **Payments gate.** PAID forms can be configured but cannot OPEN unless `APPLICATIONS_PAYMENTS_ENABLED` is set (`docs/wiki/features/applications.md`, Configuration).

---

## 4. Gap matrix: Zeffy → Jump (question C)

Status means exists / partial / missing in Jump. The verdict is for the wizard v1.

| Zeffy feature | Jump equivalent | Status | Verdict | Reason |
|---|---|---|---|---|
| Campaign-type chooser (`1.png`) | — | missing | **skip (decided)** | Owner decision. A donation type can come later as step 0 |
| Title | `Event.name` + `SlugField` | exists | **adopt** | Jump's slug stays editable later, unlike Zeffy's fixed URL [1] |
| Title font style (6 presets) | Theme typography, org level (spec 049 card C, `plan.md:59-74`) | n/a | **skip** | Fonts belong to the org's theme. A per-event font would fork the storefront look |
| One date, start + end | `Event.date` (start only) | partial | **adapt** | Start only in v1. An end time is a small schema add, left as an open decision |
| Multiple dates / recurrence | — | missing | **skip** | T12 "series vs occurrences" is unresolved (`gap-analysis.md:230-235`) |
| "No date / skip for now" | `date` required, must be in the future (`EventService.js:77`) | missing | **skip** | Drafts with no date break date sorts and dashboard queries. Keep the date required |
| Event-level sales open/close | Per-tier `saleStartDate/EndDate` | partial | **adapt** | Offer "apply to all tiers" in the Tickets step instead of a new event column |
| Address autocomplete / virtual = no address | `Venue` + `VenueFlyout` quick-add; zone derived from the address (`VenueFlyout.tsx:14`, `:253`) | partial | **adapt** | A venue picker step. Virtual events are out of scope (venue required for org scoping) |
| Description rich text | `RichTextEditorField` (sanitized on write, gotcha 20) | exists | **adopt** | Same editor. The gallery embed is not rendered on event pages (`RichTextEditor.tsx:47`; the event page uses `ContentHtml`) |
| Banner image | `EventMediaCard`, `POST …/logo` | exists | **adopt** | Event image upload |
| Banner video | Hero video is a theme section only | missing | **skip** | No event video field |
| Color / light-dark / background style | `Organization.brandColor`, `themeMode` → `BrandScope` | conflicts | **skip** | Gotchas 6/7: storefront color and theme mode are org brand tokens. Show a read-only brand summary with a link to Settings › Brand |
| Logo | Org logo / square logo (spec 049, `schema.prisma:496-506`) | exists (org) | **skip** | Org-level. The preview shows it |
| Global capacity | `Event.capacity` (ceiling, gotcha 4) | exists | **adopt** | Required 1–100,000 for TICKETED |
| Ticket title / price / description | `PriceTier` | exists | **adopt** | `TierCard` / `TierEditDialog` |
| Total available "Unlimited" | `quantityTotal` required ≥ 1 | partial | **adapt** | Default to capacity. "Unlimited" is not supported |
| Min / max per purchase | `minPerOrder/maxPerOrder` (defaults 1 / 10, `new/page.tsx:76-77`) | exists | **adopt** | Same defaults as Zeffy (max 10) |
| Scheduled availability (early bird) | Tier sale window | exists | **adopt** | Entered in the venue zone (gotcha 28) |
| Members-only rate | `TierVisibility PUBLIC/PRIVATE/HIDDEN` (`schema.prisma:1413-1417`) | partial | **adopt** | Expose as "Who can see it" |
| Pay what you can | — | missing | **skip** | Needs fee-library parity work (gotcha 12). Spec 047 D1 covers giving |
| Group ticket / bundles | — | missing | **skip** | Not demanded yet |
| Ticket categories (buyer filter) | — (`Event.category` is the listing category) | missing | **skip** | Different concept |
| Tax receipt per ticket | Spec 047 DV / D1 | planned | **skip** | Donation receipts are D1, receipt per ticket not planned |
| Tax at checkout | Org Settings › Tax → `Event.taxRate` (spec 009) | exists (org) | **skip** | Automatic per venue state. Show the resolved rate in Review |
| Drag reorder, duplicate, sold count | Move up/down + `/price-tiers/reorder` (`priceTiers.js:102`), sold bar in edit | partial | **adopt** | Add a duplicate tier action (small) |
| Additional donations | Spec 047 D1 adds a **per-event** `Event.acceptGifts` (+ `giftWithoutTicket`, `giftPresetAmounts`, `giftAppeal`) on top of org gift defaults (`plan-d1.md:113-118`, `:247-248`). D1 and DV are plans only; D0-B/C/S are merged (#372, #373, #390) | planned | **adopt, gated** | A toggle in the Collect more step, shown only when D1 is live and the org is eligible (§5.1, step 7) |
| Add-ons with image | `AddOn` + `AddOnProduct` saved add-ons, `SavedAddOnPicker` | partial | **adopt** | No add-on image (`schema.prisma:2015-2032`). ADMIN only |
| Attendee / buyer questions | Question builder exists for applications only. `Ticket` has no attendee fields (`schema.prisma:1162-1191`) | missing | **skip** | Spec 037 D13 deferred named tickets (`plan.md:78`). Open decision |
| Discount codes | — (`gap-analysis.md:101`) | missing | **skip** | T1 promo codes (`gap-analysis.md:153`). Reserve the step slot |
| Issue e-tickets toggle / ticket banner | Tickets are always issued with QR (`ticket-issuance.md:8`). Wallet passes are tabled (spec 006) | partial | **skip** | Jump always issues tickets. No ticket design surface |
| Thank-you email (custom message) | `sendOrderConfirmation`, fixed content (`EmailService.js:119`) | partial | **skip** | v1 could show a read-only "what buyers get" preview |
| Reminder 1 / 2 | RSVP reminder only, fixed ~24 h (`RsvpReminderService.js:3-14`, `EmailService.js:767`) | missing | **skip** | Ticket reminders are a new sweep plus templates. Candidate follow-up |
| Collaborators | Org members (Settings › Users), org-wide | n/a | **skip** | No per-event access model |
| Pay by check | Offline payments exist for application orders only | missing | **skip** | Box office (gap analysis) |
| Fund assignment / thermometer | — | missing | **skip** | Donation scope (spec 047 later phases) |
| Timezone dropdown | Derived from the venue (`Venue.timezone` + `timezoneSource`, `schema.prisma:804-807`) | exists | **skip input** | Gotcha 28. Show the zone read-only next to the date |
| Translate to Spanish | `autoRedirectLanguage` is stored only (`schema.prisma:536-541`) | missing | **skip** | No localization yet |
| Congrats screen | — (redirects to the list) | missing | **adopt** | View, copy link, go to the event, set up check-in |
| Progress bar, Save & exit, Skip for now, Back/Next | — | missing | **adopt** | Core of the request |
| Live preview + phone/desktop + scroll-to-section | `EventEditSummary` stub on edit only (`EventEditSummary.tsx:80`) | missing | **adapt** | See §5.3 |

**What Jump has that Zeffy lacks, and the wizard should surface:**

- **Vendor applications** with apply-then-choose, categories and `spaceSelection TIERS|MAP` (specs 037, 039).
- **Floor maps and booths**: a blank map or a saved floor plan, with a public map pill (`FloorMapButton`).
- **RSVP admission**: `admissionMode`, limit and party size (spec 034).
- **Saved tiers, saved add-ons and form templates**, picked in place (spec 037 D2, `plan.md:28`).
- **Tier visibility** (`HIDDEN`/`PRIVATE`) and the **refundable** flag with the org self-serve refund policy (gotcha 23).
- The **venue entity** with its derived time zone and tax.
- **Duplicate event** with forms, add-ons and map (`EventService.js:163-231`). It is a natural "Start from a past event" shortcut.
- **Galleries.** They exist (spec 046) but do not render in event descriptions today, so only offer them if the event page switches to `ContentWithGalleries`.

---

## 5. Proposed Jump wizard (question D, draft for the planner)

### 5.1 Steps

Legend: **R** = required to finish, **S** = skippable ("Skip for now"), **C** = conditional. Every step after the venue step persists on Next.

| # | Step | Content | Rule | Persists via | Preview pane |
|---|---|---|---|---|---|
| 1 | **Name your event** | Name. Slug auto-derived, "Edit URL" collapsed | R | Client state (no server row yet, see §5.2) | Event hero: name, org identity, placeholder date/venue |
| 2 | **Where is it?** | Pick a venue or "+ New venue" (`VenueFlyout`, the address derives the zone) | R | Client state | Hero venue block, map pin, zone label |
| 3 | **When does it start?** | `datetime-local` in the venue zone with the zone label (`zonedInputToIso`, `formatEventTime`). End time if added (open decision) | R | **Creates the DRAFT** `POST …/events` (relaxed create, §5.2) | Hero date tile in the venue zone |
| 4 | **Describe it** | `RichTextEditorField` | S | `PATCH …/events/:id {description}` | Description section (clamped + "More details") |
| 5 | **Add an image** | `EventMediaCard` | S | `POST …/events/:id/logo` | Hero image / poster card |
| 6 | **Tickets or RSVP** | `AdmissionModeField` at top. TICKETED: capacity + tiers (`TierCard`, saved tiers, options panel: quantity, min/max, sale window, visibility, refundable). RSVP: limit + party size | R (publish needs ≥ 1 active tier for TICKETED) | `PATCH` event + `POST/PATCH …/price-tiers` + `/reorder` | `TierStub` list with all-in prices (`computeTierAllInPrice`), or `RsvpPass` (disabled) |
| 7 | **Collect more** (Zeffy `12.png`, `15.png`) | **Add-ons**: `SavedAddOnPicker` (search saved, create new), price, quantity, which tiers. **Allow additional donations at checkout**: one toggle (the spec 047 D1 `Event.acceptGifts`), plus "Allow gifts without a ticket" and "Use organization amounts / Custom for this event", the same controls D1 puts on the Sales editor (`plan-d1.md:350-354`) | S. C: ADMIN only for add-ons. The donation toggle is **hidden** unless D1 is shipped (`NEXT_PUBLIC_DONATIONS_ENABLED`), Stripe Connect direct charges are on for the org (D0-S), and the org passes DV eligibility (`deductibilityStatus` ∈ {`DEDUCTIBLE_170C`, `EXEMPT_NOT_DEDUCTIBLE`} and `DONATION_TERMS` accepted, `plan-d1.md:160`). With both halves hidden, the whole step is skipped | Add-on routes (`addOns.js:40-59`); event PATCH with D1's gift fields (`plan-d1.md:248`; 400 `GIFTS_NOT_ELIGIBLE` otherwise) | Cart add-on rows; D1's shared gift picker (one component, never forked, `plan-d1.md:278`) in a disabled state |
| 8 | **Vendor applications** | "Accept vendors?" yes/no. Yes: name (prefilled "<Event> Vendor Application"), start from a template or a Jump default, categories (`TiersCard`), space selection TIERS/MAP, approval reserves a space, open/close dates (venue zone), questions (`QuestionsCard`) | S. C: ADMIN. PAID needs `APPLICATIONS_PAYMENTS_ENABLED` to open | `POST /admin/events/:id/application-forms` (kind PAID) + question routes | `GetInvolved` pill ("Become a vendor") + the apply form's first step |
| 9 | **Special guests** | "Invite special guests to apply?" FREE form with guest-oriented default questions (bio, socials, appearance needs, travel) | S. C: ADMIN | Same route, kind FREE | Pill + apply form |
| 10 | **Volunteers** | "Recruit volunteers?" FREE form, **business details off**, default questions (availability as multi-choice days/shifts, roles of interest, T-shirt size, emergency contact) | S. C: ADMIN. Needs `collectBusiness:false` allowed on event forms | Same route | Pill ("Volunteer") + apply form |
| 11 | **Floor map** | Blank map / from a saved floor plan / later. Explains that MAP space selection needs a published map | S. C: shown only when step 8 created a form (or always for vendor events, open decision) | Map create routes (`maps.js:58`), `mapsApi.createFromFloorPlan` | Map thumbnail / "Floor map" pill |
| 12 | **Review & publish** | Checklist of every step (done / skipped / blocking), brand summary (logo, colors, theme mode, read-only, links to Settings › Brand), resolved tax rate, listing category, form statuses. Actions: **Publish** or **Save as draft** | — | `POST …/publish`; optionally open forms (`PATCH form status OPEN`) | Full event page, phone/desktop |
| 13 | **Done** | "Your event is live" (or "Saved as draft"). Cards: View page, Copy link, Go to event (Details), Set up door check-in / Review applications | — | — | Same as 12 |

Notes on order:

- The venue comes before the date. Spec 033 makes the venue's wall clock the input frame. The current page already says "Pick a venue first" (`new/page.tsx:477`).
- Admission sits inside the Tickets step, as Zeffy puts capacity at the top of Tickets (`11.png`). Switching mode is locked once orders or RSVPs exist (RSVP D11, `rsvp-events.md:71`), which can't happen in a draft. The step should still use the same API so the lock holds.
- The three application steps are separate, as the owner asked. Each creates at most one form; more forms go through the event's Applications tab.
- Step slots reserved for later: **Discount codes** (after Collect more, when T1 ships), **Attendee questions** (after Tickets, if named tickets are approved), **Reminders / communications** (before Review).
- **Donation status, checked 2026-10-10.** Spec 047 D0-B, D0-C and D0-S are merged (`origin/main` #372, #373, #390). DV (verification, `plan-dv.md:3`) and D1 (gifts at checkout, `plan-d1.md`) are plans with nothing built. D1 ships dark behind `DONATIONS_ENABLED` / `NEXT_PUBLIC_DONATIONS_ENABLED` (`plan-d1.md:432-436`). The donation toggle in step 7 can be built when D1 lands. The wizard should not add its own gift columns.
- **Steps as a per-type list.** Define the flow as data, e.g. `WIZARD_TYPES = { event: [title, venue, date, …, review, done] }`, with each step declaring its `visible(ctx)` rule (role, admission mode, flags), its preview anchor and its save call. The progress bar, step menu, Skip/Next and resume then work for any type. Standalone donation pages are spec 047 D3's org `/donate` page and D2 campaigns (`2026-10-08-donation-platforms.md:73`, `:416`, `:422`). D1's donate-only lives on an event (`giftWithoutTicket`), so it needs no new type. If owners later want a "Donation campaign" wizard, it becomes a second entry in that list, plus the step 0 chooser that was deferred, and the event steps stay unchanged.

### 5.2 Draft, Save & exit, resume

- **Server row from step 3.** Without a venue the event has no org (`schema.prisma:930-953`), so the draft row is created once title, venue and date are known. Steps 1–2 keep their state on the client (`sessionStorage` or React state). On those steps, Save & exit either becomes **Exit**, as on Zeffy's first step (`2.png`), or asks "Discard this event?".
- **Relaxed create, needed.** Allow `POST …/events` for a DRAFT **without tiers**: the validator requires ≥ 1 tier (`eventValidators.js:44-45`) and the service already accepts an empty list (`EventService.js:116`). Publish already enforces "≥ 1 active tier" (`:416-420`). Capacity is also required at create (`eventValidators.js:37-43`) though the tickets step comes later. Either default it (for example, set it on step 6 and create with a provisional value) or make `capacity` nullable for drafts and check it on publish. This is a planner decision, and it touches `updateEvent`'s capacity floor (`EventService.js:322-335`) and every capacity read.
- **Each Next saves its step.** It uses the same endpoints the section editors use, so there is no second write path. Save & exit = save the current step if valid, then go to the event's Details page (spec 037 says editing starts and ends there).
- **Resume.** Add a nullable progress marker to `Event` (for example `setupStep` or `setupCompletedAt`). DRAFT events whose setup is unfinished show **"Continue setup"** on the list card and the Details hero, and it opens `/admin/events/[eventId]/setup?step=<n>`. A new model or field must be mapped in `audit/features.js` (spec 048, `packages/db/AGENTS.md`).
- **Publish.** It is explicit, at the Review step (recommended). Zeffy auto-publishes at "Congrats" [3], but Jump has payments readiness, forms with their own open state, and the `APPLICATIONS_PAYMENTS_ENABLED` gate. Add a server-side readiness check that returns a list (future date, venue, TICKETED ≥ 1 active tier and capacity set) so Review and the Publish button show the same blockers.
- **Unpublish.** Missing. Proposal: `POST …/unpublish` PUBLISHED → DRAFT only while there are no orders, no GOING RSVPs and no submitted applications. Otherwise Cancel stays the only exit. Open decision.
- **Editing an existing event.** (Superseded by open decision 15 once the edit-mode screenshots in §2.3 arrived.) Keep the spec 037 Details page, section editors and flyouts (D10). The wizard is for **creation and resuming unfinished drafts** only. Re-entering the wizard on a published event would duplicate the section editors, and the flyouts already cover small edits.
- **Every "Create Event" click starts the wizard.** Point `EventsPageHeader.tsx:61` and `venues/[venueId]/page.tsx:371` (with `?venueId=` to preselect the venue) at the wizard, and retire the single-page `/admin/events/new` form. "Duplicate event" stays a separate path (`DuplicateEventDialog`).

### 5.3 Live preview

- **The gap.** `EventDetailClient` fetches `GET /events/:id` itself and that read refuses drafts (`EventDetailClient.tsx:159`, `EventService.js:580`), so it cannot render a draft as is.
- **Recommended: split the page.** Extract the 1,003-line `EventDetailClient` into a data loader plus a presentational **`EventPageView({ event, preview })`**. The view renders the hero, `TierStub`s, `RsvpPass`, `GetInvolved`, `FloorMapButton` and the description through `ContentHtml`, inside `BrandScope` with the org's `brandColor` / `themeMode` (`EventDetailClient.tsx:354`). `preview` turns off cart, checkout, RSVP submit and the dialogs. The wizard feeds it from its own form state, so it updates as the organizer types, and placeholder values render faded, as in Zeffy (`3.png`).
- **Phone / desktop toggle.** Render the view in a fixed-width frame: 390 px and about 1,280 px scaled to fit. A container width is not enough. The page uses `lg:` media queries, so a true phone/desktop render needs an `<iframe>` (a same-origin admin preview route that posts state in) or container queries. Planner decision; the iframe is more faithful.
- **Scroll to section.** Each step names a preview anchor (`#hero`, `#tickets`, `#description`, `#get-involved`). Scroll **inside the preview container only**. `scrollIntoView` scrolls the admin frame (`frontend/AGENTS.md:54`, `event-editor.md:55`).
- **Themed orgs.** These render the event page inside the theme frame on the server (`app/events/[eventId]/page.tsx:20-31`). The in-pane preview can show the unthemed page plus the org header, which is accurate enough for content. "Open full preview" should use a **signed draft-preview link**, modelled on `ThemePreviewService.mint` (`ThemePreviewService.js:21-36`), so the real themed page renders a draft for staff.
- **Mobile.** Below `lg`, the preview moves behind an eye button (a full-screen sheet, reusing `Flyout` as a bottom sheet) and the step list behind a menu button, as in `1-mobile-layout-example.png`. Sticky Back / Next footer.
- **Layout.** The wizard should be a focused full-screen shell (progress bar, Save & exit), not the admin sidebar plus a form card. Planner decision on whether it lives under the admin layout with the sidebar collapsed (the icon rail exists, PR #348) or in a separate route group. Either way it must keep `AdminRoute` and the edge middleware guard.

### 5.4 Open decisions for the owner

1. **Draft before venue.** Keep steps 1–2 client-only and create at step 3 (recommended), or add `Event.organizationId` so a title-only draft can be saved. The second has a large blast radius: every query scopes through `venue.organizationId`.
2. **Capacity at draft create.** Make `capacity` nullable for drafts, or create with a provisional value.
3. **End time.** Add `Event.endDate`, which Zeffy requires and email or calendar links would use, or keep start only.
4. **Publish model.** Explicit Publish at Review (recommended), or Zeffy-style auto-publish on finish. Also: should publishing open the event's DRAFT application forms automatically?
5. **Unpublish.** Allow PUBLISHED → DRAFT when nothing has been sold or submitted, or keep Cancel only.
6. **Form purpose.** Add `ApplicationForm.purpose` (VENDOR / SPONSOR / PRESS / PANEL / SPECIAL_GUEST / VOLUNTEER / OTHER), so steps 8–10 know their form and `GetInvolved` stops guessing from names. The alternative, a naming convention plus a regex for "guest", is fragile. Sponsors have no step of their own: confirm whether they belong in step 8 (a second PAID form) or the Applications tab only.
7. **What "special guest" means.** An application form (guests apply, organizer approves), as asked, or also a public **guest lineup** on the event page, which neither Jump nor Zeffy has. Is it FREE only, and do guests fill in the business profile (bio, socials, photos fit it)?
8. **Volunteers.** Allow `collectBusiness:false` on event forms (needed). Is v1 questions-only (availability as multi-choice), or do volunteers need shifts and roles with capacity? Shifts do not exist today and would be a spec of their own.
9. **Floor map step.** Show it only when a vendor form was created, or for every event.
10. **ORGANIZER role.** Add-ons and forms are ADMIN-only (`rbac.js:33`, `admin.js:784`, `addOns.js:15`). Should ORGANIZERs see steps 7–11 hidden, read-only with "ask an admin", or should those steps open to ORGANIZER?
11. **Deferred Zeffy steps.** Confirm skipping attendee questions, discount codes, reminders and e-ticket design in v1, with slots reserved. Discount codes depend on T1.
12. **Preview fidelity.** In-pane React view plus an optional signed full preview (recommended), or iframe only.
13. **Donation toggle placement.** Should it live only in Collect more (recommended, as on Zeffy `12.png`), or also be prompted at Review for eligible orgs? Note that D1 also defines org-level gift defaults (Settings › Donations), so the wizard only sets the per-event override.
14. **"Start from a past event."** Offer `duplicateEvent` as an entry on step 1, or keep it on the list only.
15. **Edit mode (from §2.3).** (a) Zeffy model: Edit on the event workspace reopens the wizard with a "Jump to edit…" step list and Save & share / Save & exit. The wizard becomes the one editing surface, and the spec 037 section editors are retired or reduced to flyouts. (b) Keep the section editors for published events and use the wizard only to create events and resume drafts. (c) Hybrid: every section editor's "Edit" opens the wizard at that step (`/setup?step=<n>`), so both entry points share one form per step. (c) avoids building two forms for every field, which (b) does not. Recommended: **(c)**.
16. **Close sales.** Add "Close sales" (stays published, checkout off) next to Cancel, as in Zeffy's ⋯ menu (`16c`).

---

### 5.5 Owner decisions (2026-10-10)

These answer every item in §5.4.

1. **Draft before venue:** steps 1–2 stay in the browser. The server row is created at step 3.
2. **Capacity:** may be empty on drafts. Publish checks it.
3. **End time:** add `Event.endDate`, **optional**.
4. **Publish:** an explicit button at Review. **Form configuration moves into the wizard.** The owner wants to remove the event-level Applications › Forms configuration section and make the wizard the one place to add and configure application forms. Publishing opens the event's forms (planner to confirm whether this happens on publish or per form). Reviewing submissions stays in the workspace Applications tab (`SubmissionsTable`, gotcha 18). Only configuration moves.
5. **Unpublish:** allowed. The guard rules in §5.2 still need planning: no orders, RSVPs or submissions.
6. **Form purpose:** yes, as the way the wizard places forms. An organizer adds a form of any purpose inside the wizard. Planner: whether sponsor (and press/panel) get their own steps or a generic "Other applications" step, and whether one step can hold several forms.
7. **Special guests:** both an application form **and** a public guest lineup on the event page. The lineup is new work.
8. **Volunteers:** organizers need flexibility, so custom questions are always available, and shifts/roles are allowed. Shifts are new work, likely their own spec.
9. **Floor map step:** optional, never required. Vendors choose a space either by a text location selector or by a configured floor map (spec 039 TIERS | MAP choose step). The wizard asks which one, and the map builder is shown only when MAP is chosen.
10. **Roles:** every wizard step is available to ORGANIZER. Today these are ADMIN-only:
    - event application form config (create/patch/delete form, tiers, questions, tier add-ons, save-as-template; `admin.js:784-837`);
    - application templates (`admin.js:752-765`);
    - add-on config writes (`addOns.js:15`);
    - standing forms (`admin.js:661-693`).

    The only recorded reason is a rule, with no rationale behind it: "form configuration is ADMIN" (`specs/011-applications/spec.md:65`, `specs/012-add-ons/spec.md` FR-015). Ticket tiers, which also set prices, are already ORGANIZER. Proposal: open event-scoped form, template and add-on configuration to ORGANIZER. Keep money-moving actions ADMIN: application refund, waive, offline payment (`admin.js:878`, `:899`, `:903`), `RefundService.refundOrder` (gotcha 17), and org settings. Standing forms are org-level rather than wizard steps, so they keep their current rule unless the owner says otherwise.
11. **Deferred:** discount codes, attendee questions, reminders. Slots are reserved.
12. **Preview:** in the wizard, plus a private (signed) full-preview link.
13. **Donation toggle:** in Collect more **and** suggested again at Review for eligible orgs.
14. **Start from a past event:** yes. Offered as an entry on step 1 (`duplicateEvent`).

15. **Edit mode: (c) hybrid.** The spec 037 event page (Details + workspace tabs) stays. Every section's **Edit** opens the wizard at that step (`/admin/events/[id]/setup?step=<n>`), with a "Jump to edit…" step list, Save & exit, and a return to the event page. Each field has one form, and the section editors are replaced by links into the wizard.
16. **Close sales:** add it next to Cancel. The event stays published, checkout and new applications are off, and it can be reopened.
17. **Several forms per step:** yes. For example, two vendor forms, each with its own tiers and questions. Sponsor, press and panel forms have no step of their own. **Default unless the owner says otherwise:** one "Other applications" step that holds any number of forms, each with a purpose picker (sponsor / press / panel / other).

## 6. Reuse inventory (question E)

| Need | Reuse | Path |
|---|---|---|
| Form shell bits, inputs, admission, RSVP fields, tier header | `EventFormShell`, `FormCard`, `EventFormActions`, `AdmissionModeField`, `RsvpSettingsFields`, `TierHeaderActions`, `inputClass`/`labelClass`/`hintClass` | `frontend/src/components/events/EventFormLayout.tsx:14-17`, `:23`, `:115`, `:171`, `:235`, `:275`, `:352` |
| Name URL | `SlugField` (409 → slug error) | `frontend/src/components/SlugField.tsx`; usage `new/page.tsx:346-353` |
| Description | `RichTextEditorField` (Tiptap, `ssr:false`) | `frontend/src/components/editor/RichTextEditorField.tsx:14` |
| Event image | `EventMediaCard` (drag/drop, type check) | `frontend/src/components/events/EventMediaCard.tsx:17` |
| Venue pick / create, zone display | `VenueFlyout` + `NEW_VENUE_OPTION`, `VenueTimeZoneField`, `TimeZoneSelect` | `frontend/src/components/VenueFlyout.tsx:17`, `:52`; `VenueTimeZoneField.tsx:31`; `TimeZoneSelect.tsx:27` |
| Venue-zone date math | `zonedInputToIso`, `zonedInputToInstant`, `formatEventTime`, `DEFAULT_ZONE`, `timeZoneLabel` | `frontend/src/lib/eventTime.ts`, `lib/timeZones.ts` (parity pair with the backend, gotcha 28) |
| Tiers | `TierCard`, `TierEditDialog`, `TierPresetMenu` (saved tiers), `TierFlyout` | `frontend/src/components/TierEditDialog.tsx:36`, `:172`; `events/TierPresetMenu.tsx:52`; `events/EventFlyouts.tsx:234` |
| Capacity visual | `CapacityMeter`, `tierAccent`, `EventStatusPill`, `Perforation` | `frontend/src/components/events/EventEditSummary.tsx:23`, `:39`, `:257`, `:289` |
| Add-ons | `SavedAddOnPicker`, `SavedAddOnFlyout`, `AddOnsSection` | `frontend/src/components/events/SavedAddOnPicker.tsx:58`, `:330`; `admin/events/[eventId]/edit/AddOnsSection.tsx` |
| Application forms | `SettingsCard`, `TiersCard`, `QuestionsCard`; `useApplicationsApi().createForm`; template list (`useParticipantsApi().templates`) | `frontend/src/components/applications/FormEditorCards.tsx:68`, `:328`, `:524`; `admin/events/[eventId]/applications/useApplicationsApi.ts:100` |
| Form settings in place | `FormSettingsFlyout` | `frontend/src/components/events/EventFlyouts.tsx:377` |
| Mobile sheet / side panel | `Flyout` (focus trap, Escape guard, bottom sheet on phones) | `frontend/src/components/Flyout.tsx:14` |
| Section scrolling | `jumpTo` (scrolls `<main>`, never the frame) | `frontend/src/components/events/EventEditSummary.tsx:219` |
| Preview pieces | `BrandScope`, `TierStub`, `RsvpPass`, `GetInvolved`, `FloorMapButton`, `ContentHtml`, `EventStub`, `OrganizationHeader` | `components/BrandScope.tsx:29`; `app/events/[eventId]/TierStub.tsx:33`, `RsvpPass.tsx`, `GetInvolved.tsx:28`, `FloorMapButton.tsx`; `components/storefront/ContentHtml.tsx`, `EventStub.tsx:31` |
| All-in price on preview cards | `computeTierAllInPrice` (fee parity, gotcha 12) | `frontend/src/lib/fees.ts` |
| Draft preview link pattern | `ThemePreviewService.mint` (signed, TTL) | `backend/src/services/ThemePreviewService.js:21-36`; `routes/themes.js:105` |
| Backend writes | `createEvent`, `updateEvent`, `publishEvent`, `duplicateEvent`; price-tier routes incl. `/reorder`; add-on routes; `ApplicationFormService.createForm` (template); map create / floor plan | `EventService.js:49`, `:240`, `:398`, `:163`; `routes/priceTiers.js:39-102`; `routes/addOns.js:40-75`; `ApplicationFormService.js:220`; `routes/maps.js:58` |
| Event workspace facts after Done | `useEventWorkspace`, `workspaceTabs` | `frontend/src/components/events/EventWorkspace.tsx:37`, `:55` |

---

## 7. Risks and gotchas (question F)

- **Org scoping goes through the venue.** No venue means no org (root `AGENTS.md` "Org scoping"). Any draft-before-venue design must change that, which is decision 1.
- **Venue time zones** (gotcha 28). Read and write every date and sale window through `instantToZonedInput` / `zonedInputToInstant` in the **venue's** zone and always render the abbreviation. No per-event time-zone dropdown. Changing the venue re-anchors the typed time (`new/page.tsx:97-99`).
- **Capacity is per tier, with the event as a ceiling** (gotcha 4). Tier totals ≤ capacity is checked on create (`EventService.js:82-92`), and on update capacity can't drop below the tier sum (`:327-333`). The wizard's tier step must show the same warning (`new/page.tsx:230-235`, `:391-396`).
- **RSVP ≠ Order** (gotcha 29). Branch on `admissionMode`, never on `priceTiers.length === 0`. RSVP needs no tiers to publish (`EventService.js:416`).
- **Brand tokens** (gotchas 6/7). Preview colors come from `BrandScope` with the org's color and `themeMode`. Never call `setTheme`, and never hardcode per-event colors.
- **Sanitize on write** (gotcha 20). The description goes through `sanitizeContentHtml` on create and update (`EventService.js:107`, `:311`) and renders only through `ContentHtml`.
- **Fee parity** (gotcha 12). Preview prices must use `lib/fees.ts`. Never compute all-in prices ad hoc.
- **One ledger** (gotcha 17) and **add-ons are `OrderAddOn`** (gotcha 16). The wizard only configures. It must not invent money surfaces.
- **Applications.** One `SubmissionsTable` and scoped services, never fork (gotcha 18). Templates are materialized through `ApplicationFormService._materialise` (gotcha 18). PAID forms need `APPLICATIONS_PAYMENTS_ENABLED` to open (gotcha 15). Public forms 404 until the event is PUBLISHED (`ApplicationService.js:334`).
- **RBAC.** Events are ORGANIZER, add-ons and forms are ADMIN. A wizard that calls ADMIN routes for an ORGANIZER gets 403s mid-flow (decision 10).
- **Admin scrolling.** Never `#anchor` or `scrollIntoView` in admin (`frontend/AGENTS.md:54`). This applies to the preview pane too.
- **`useSearchParams()` needs `<Suspense>`** (root `AGENTS.md` Core Constraints). The wizard will read `?step=` and `?venueId=`.
- **Audit trail** (spec 048). New fields or models (`setupStep`, `purpose`) must be mapped in `audit/features.js`.
- **Playwright CI** (gotcha 11). New admin specs must use `signInAsStaff`, mock the API with `page.route`, and scope assertions to visible elements: the preview pane will duplicate text such as the event name and tier names.
- **Old E2E specs.** `frontend/e2e/admin-event-form-layout.spec.ts` covers the current create page (`event-editor.md:22`) and will need rewriting when `/admin/events/new` becomes the wizard.
- **Zeffy differs on time zones.** It shows visitor-local times on the public form [8]. Jump deliberately always shows the venue zone (gotcha 28). Do not copy Zeffy here.

---

## Sources

Screenshots (captured 2026-10-10): `/Users/jj/Downloads/Event/1.png` … `22.png`, `1-mobile-layout-example.png`.

1. Zeffy, "Configuring an Event Campaign on Zeffy" — https://support.zeffy.com/configuring-an-event-campaign-on-zeffy-rd9ar
2. Zeffy, "An Overview of Zeffy's Event Feature" — https://support.zeffy.com/an-overview-of-zeffys-event-feature-j6ymd (index: https://support.zeffy.com/event-form-configuration-31vs1)
3. Zeffy, "Sharing your Zeffy campaign with your supporters and community" — https://support.zeffy.com/sharing-your-zeffy-campaign-with-your-supporters-and-community-k5z1c
4. Zeffy, "Setting up an event with multiple dates and times" — https://support.zeffy.com/setting-up-an-event-with-multiple-dates-and-times-h4jnl
5. Zeffy, "Editing and scheduling a reminder email" — https://support.zeffy.com/editing-and-scheduling-a-reminder-email-3egjl
6. Zeffy, "Schedule ticket availability or add a waitlist to an event" — https://support.zeffy.com/schedule-ticket-availability-or-add-a-waitlist-to-an-event-l8rp6
7. Zeffy, "Managing thank-you / confirmation emails" — https://support.zeffy.com/managing-thank-you-confirmation-emails-82kjy
8. Zeffy, "Managing your event time zone" — https://support.zeffy.com/managing-your-event-time-zone-swcx4

Jump: `origin/main` `19c65b2`. Prior notes: [Industry gap analysis](./2026-10-10-industry-gap-analysis.md) (T1 promo codes, T12 series), [Donation platforms](./2026-10-08-donation-platforms.md) (Zeffy as the nonprofit comparator), specs 033, 034, 037, 039, 044, 047, 049.
