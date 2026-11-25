# Spec 058: Writing assistant ("Polish" button)

## Context
The readiness checklist only checks whether a description is blank (`EventReadinessService`, `NO_DESCRIPTION`). It never reads the text. The owner asked (2026-10-18) whether the platform could also review grammar and suggest more relevant content. This spec adds a **Polish** button next to the organizer's description fields. Claude suggests a corrected version and points out useful facts that are missing. The organizer accepts or dismisses the suggestion. Nothing changes without a click.

Jump has no LLM integration yet. Provider research lives in `docs/research/2026-10-07-llm-provider-selection.md`. That note names a "Haiku 5.5" model, which the current Anthropic model table does not list. This plan uses the IDs from that table (see Decisions).

## Scope
v1 covers two fields, the ones the publish checklist points to:
- **Event description** (`DescribeStep.tsx`, Tiptap HTML through `RichTextEditorField`, live events)
- **Registration form intro** (`FormEditorCards.tsx` `f-intro`, a plain-text textarea, registration events and other forms)

Not in v1: blog posts, pages, the theme editor, and **store policies**. Policies are legal text, and the assistant must never rewrite them. Writing a description from scratch is also out: the button needs some text to start from. Each of these is one `kind` value away once v1 has proved itself.

## UX
- A **Polish** button (sparkle icon, secondary style) sits under the field. It is disabled while the field is empty or under 20 characters, and it is hidden without the permission (below).
- Clicking it shows a spinner and then an inline panel under the field. Use the same panel on both steps. Never use a modal: the live preview has to stay visible.
  - **Suggested version**: the rewritten text, rendered the way it will appear. HTML goes through `ContentHtml`.
  - **What changed**: up to 5 short bullets, e.g. "Fixed 'do you see it' → 'Do you see it?'".
  - **Consider adding**: up to 3 facts the text lacks, phrased as questions to the organizer, e.g. "Is parking free?" or "Can vendors bring their own tables?". These are never written into the text: the model must not invent facts.
  - Buttons: **Use this** replaces the field value (it goes into Tiptap history, so Ctrl+Z undoes it). **Dismiss** closes the panel. **Try again** makes a new call.
- Errors show inline and leave the field untouched. A 429 reads "Too many requests, try again in a minute". A 503 reads "Writing help isn't available right now".
- A PUBLISHED event still saves only through Save, never autosave (gotcha 39). Accepting a suggestion only changes the field.

## Backend
- **Route**: `POST /admin/writing/polish`. The middleware chain is `requireAuth` → `requireFeature('writingAssistant')` → a limiter.
  - Body: `{ kind: 'event-description' | 'form-intro', text, eventId?, formId? }`. `text` is at most 10,000 characters (400 above that).
  - Response: `{ text, changes: string[], suggestions: string[] }`
- **Context** (loaded on the server and scoped to the active org through `activeOrgFor(req)`, so a foreign id is a 404): event name, type, date, venue name and city, and the linked event's name for a registration event. The model gets these so it can check the text against them, not so it can restate them.
- **`WritingAssistantService.polish`**:
  - SDK: `@anthropic-ai/sdk`, installed in the backend workspace from the repo root.
  - The client is built lazily from `ANTHROPIC_API_KEY`. Unset means `503 AI_UNAVAILABLE`, which mirrors how other optional integrations deploy dark.
  - Call `client.messages.create` with structured output: `output_config.format`, a JSON schema with `text`, `changes` (max 5) and `suggestions` (max 3).
  - The model comes from `WRITING_ASSISTANT_MODEL`, default `claude-opus-5`, at `output_config.effort: 'low'`, with `max_tokens` 4000. Check `stop_reason`: `refusal` and `max_tokens` return 502 `AI_FAILED`, never partial text.
  - Use a fixed system prompt with `cache_control` so repeated calls are cheap. The organizer text goes in the user turn, wrapped in a tag and labelled as content to edit. It is data, never instructions.
  - HTML in, HTML out for `event-description`. The output passes through `sanitizeHtml` before it is returned (gotcha 20: the model is just one more untrusted writer). `form-intro` is plain text with tags stripped.
  - Nothing is stored. Log `usage` (input, output and cache tokens), org id and kind for cost tracking. Never log the text.
- **Prompt rules**: fix spelling, grammar and clarity. Keep the organizer's voice, language and length (within ±30%). Never add facts: no prices, dates, names, policies or amenities that aren't in the text or the context. Put missing facts in `suggestions` as questions. Don't change dates or times that are already in the text. Reply in the language of the input.
- **Rate limit**: `makeLimiter('WRITING_POLISH', { windowMs: 60_000, limit: 10 })` per IP, with the usual `RATE_LIMIT_WRITING_POLISH_*` overrides. Add a per-org daily cap only if the cost logs show abuse.

## Visibility (gotcha 38)
- New catalog feature `writingAssistant`, label "Writing assistant", with `adminPaths: []` (a button, not a page) and no actions. It is on for ADMIN and ORGANIZER by default.
- The **platform switch starts off**, so a SYSTEM_ADMIN turns it on in System › Roles once the API key is set. There is no new env flag beyond the secret and the model.
- Frontend: render the button only with `useCan('writingAssistant')`.

## Privacy
- Descriptions are public storefront copy, not buyer data. Even so, Anthropic becomes a subprocessor: add it to the subprocessor list that spec 023 owns before the switch is turned on. Use a commercial API key, which has no training on inputs.
- The prompt never includes contacts, orders or application answers.

## Tests (CI has no network)
- Unit: the service takes an injectable client. A fake returns fixed JSON, and the tests assert sanitisation (a `<script>` from the "model" is stripped), the refusal and max_tokens handling, and the over-length 400.
- Contract:
  - 403 when the feature is hidden for the role (pin `permissionService._cache`)
  - 404 for another org's `eventId`
  - 503 with no key
  - 200 shape with the fake client
- Vitest: the panel's Use this, Dismiss and Try again states. Playwright: one spec that mocks the route on the Describe step.
- `npm run verify:writing` is a manual script that calls the real API with three sample descriptions and is kept outside `npm test`, like `verify:stripe`.

## Cost
A typical call is about 1.5k tokens in (a cached system prompt plus the text) and about 0.8k out.
- `claude-opus-5` ($5 / $25 per MTok): about $0.03 per call, so 1,000 calls a month is about $30.
- `claude-haiku-4-5` ($1 / $5): about $0.005 per call, so 1,000 calls is about $5.

Changing models only means setting `WRITING_ASSISTANT_MODEL`.

## Cards
- **058-A Backend**: SDK install, `WritingAssistantService`, route, validator, limiter, catalog feature, unit and contract tests, `verify:writing`.
- **058-B Frontend**: `PolishPanel` component, the button on the Describe step and the form intro, `api.ts` call, Vitest and Playwright tests.
- **058-C Docs**: `docs/wiki/features/writing-assistant.md` (names the catalog key), `ANTHROPIC_API_KEY` and `WRITING_ASSISTANT_MODEL` rows in the env table in `AGENTS.md`, and the subprocessor note in the launch checklist.

## Decisions for the owner
1. **Model**: Opus 5 (the default, best edits, about $0.03 per call) or Haiku 4.5 (about 6× cheaper and good enough for grammar)?
2. **Organizers**: may the ORGANIZER role use it by default, or only ADMIN?
3. **Later fields**: should blog posts and pages come next, and should "Draft one for me" on an empty field come after v1?
