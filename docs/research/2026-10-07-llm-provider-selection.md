---
type: research
title: LLM provider selection — cheapest capable model to build into Jump
status: reference
created: 2026-10-07
updated: 2026-10-07
project: jump
tags: [jump, research, llm, ai, pricing, anthropic, openai, gemini, privacy]
source: provider pricing pages, model docs and data-policy pages; Artificial Analysis and Arena leaderboards (see Sources). All accessed 2026-10-07. Jump code at origin/main 5c8b63a
---

# LLM provider selection: research for Jump

**Question.** What is the cheapest and most capable LLM service Jump can integrate? The likely jobs are:
- organizer-facing content generation: event descriptions, blog posts, page copy;
- **alt text for gallery images**, which needs vision;
- summaries of applications and submissions;
- customer-support style Q&A;
- structured extraction through JSON output or tool calling.

Expected volume is low to moderate, and Jump is a cost-sensitive startup.

**Starting point.** Jump has no LLM SDK today. `package.json`, `backend/package.json` and `frontend/package.json` on `origin/main` (`5c8b63a`) have no Anthropic, OpenAI, Google, Mistral or Groq dependency. The [agent store access research](./2026-10-05-agent-store-access.md) and spec 045 cover the *opposite* direction: organizers' own LLMs calling into Jump over MCP. Neither covers Jump calling an LLM itself. This note does.

**About the citations.** Prices and claims carry a bracketed number that points to the Sources list. Every source was accessed on 2026-10-07. Benchmark scores that a vendor published about its own model are marked *(vendor-claimed)*. Anything not confirmed from a primary page is tagged **UNVERIFIED**.

---

## 1. TL;DR

- **Default model: Claude Haiku 5.5 (`claude-haiku-5-5`)** on the Anthropic API. It costs **$0.10 input / $0.50 output per million tokens** for prompts up to 100k tokens, with cache reads at $0.01 and batch at 50% off [1][3]. It accepts text and image input, has a 1M context window, supports structured outputs and strict tool use, and is GA [3][6].
  - On the Artificial Analysis Intelligence Index it scores **43**. GPT-6 Luna scores 38 at the same list price, and Gemini 3.8 Flash scores 41 at 7.5× the input price [10][11][12].
  - **Caveat:** it was released *today* (2026-10-07). Run a 20–50 sample eval on our own prompts before committing.
- **Cheapest tier for bulk work** (alt text, application summaries, backfills): the same Haiku 5.5 through the **Message Batches API**, at $0.05 / $0.25 per MTok [1]. Alt text for 20,000 photos costs about **$3**.
- **Step up only for long, public-facing copy:** Claude Sonnet 5.5 (`claude-sonnet-5-5`, $2 / $10) [1][4]. It scores 56 on the Intelligence Index [10]. Make it a per-route switch, not the default.
- **Fallback provider: OpenAI `gpt-6-luna`.** It has the same $0.10 / $0.50 list price, image input, function calling, 1.05M context, no training on API data, and 30-day log retention [7][8][15]. Gemini 3.8 Flash is a stronger but pricier alternative ($0.75 / $3.75), and only its **paid** tier is acceptable [9].
- **Don't use** any free tier that trains on inputs (the Gemini free tier [9]), or DeepSeek's first-party API for buyer PII (data is stored in the PRC [16]).
- **Illustrative workload** (§5): about **$47/month** with Sonnet for copy and Haiku for everything else, or about **$13.50/month** with Haiku only.

---

## 2. Price and capability table (standard API, USD per million tokens)

| Provider · model (ID) | Input | Output | Cache read | Batch | Context | Vision | JSON / tools | Source |
|---|---|---|---|---|---|---|---|---|
| Anthropic · Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 (≤100k prompt) / $0.50 (>100k) | $0.50 / $2.50 | $0.01 / $0.05 | 50% off | 1M | yes | yes (GA) | [1][3][6] |
| Anthropic · Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2 | $10 | $0.10 | 50% off | 1M | yes | yes | [1][4] |
| Anthropic · Claude Opus 5.5 (`claude-opus-5-5`) | $4 | $20 | $0.20 | 50% off | 1M | yes | yes | [1][2] |
| Anthropic · Claude Haiku 4.5 (`claude-haiku-4-5`, previous gen) | $1 | $5 | $0.10 | 50% off | 200k | yes | yes | [1] |
| OpenAI · GPT-6 Luna (`gpt-6-luna`) | $0.10 | $0.50 | $0.01 | 50% off (Batch / Flex) | 1.05M | yes | yes | [7][8] |
| OpenAI · GPT-6.1 Sol (`gpt-6.1-sol`) | $2 | $10 | $0.10 | 50% off | 1.05M | yes | yes | [7][8] |
| OpenAI · GPT-5 nano (`gpt-5-nano`, older) | $0.05 | $0.40 | $0.005 | 50% off | — | — | — | [7] |
| Google · Gemini 3.8 Flash (`gemini-3.8-flash`) | $0.75 | $3.75 | $0.075 | $0.375 / $1.875 | **UNVERIFIED** | yes | yes | [9][13] |
| Google · Gemini 3.1 Flash-Lite (`gemini-3.1-flash-lite`) | $0.25 | $1.50 | $0.025 | $0.125 / $0.75 | **UNVERIFIED** | yes | yes | [9][13] |
| DeepSeek · DeepSeek-Flash (`deepseek-flash`) | $0.15–$0.30 (miss) | $0.60–$1.20 | $0.003–$0.006 | off-peak = half | 1M | yes | yes | [14] |
| xAI · Grok 4.3 (`grok-4.3`, <200k) | $1.25 | $2.50 | $0.20 | — | 1M | not listed | — | [17] |
| Mistral · Large | $0.50 | $1.50 | — | — | — | — | — | [18] (only figure on the page) |

Notes:
- **Gemini 3.x Flash.** The $0.75 / $3.75 price runs "through Dec 31, 2026" [9], so expect it to change.
- **Thinking tokens bill as output.** Haiku 5.5 runs adaptive thinking at `medium` effort by default [3]. Set `effort: "low"` on alt text and summaries.
- **Haiku 5.5 sampling parameters.** It rejects non-default `temperature` / `top_p` / `top_k` with a 400 error [3].
- **Tokenizer change.** Haiku 5.5 and Claude 4.7+ use a newer tokenizer that produces about 30% more tokens for the same text than Haiku 4.5 [1][3]. Even so, per-task cost is still about 75% lower than Haiku 4.5 *(vendor-claimed)* [5].
- **Groq and Together/Fireworks/OpenRouter.** Groq's pricing page returned no model list. Together, Fireworks and OpenRouter were not checked: open-weight models score well below Haiku 5.5 on Artificial Analysis (Llama 4 Scout 8, Mistral Large 4 38) [10], and they add a second vendor with no price advantage at this volume. **UNVERIFIED / not pursued.**
- **Bedrock / Vertex.** Haiku 5.5 is also on Bedrock and Google Cloud, which set their own prices [1][3]. That is only worth it if Jump moves off Railway into one of those clouds.

---

## 3. Capability evidence

| Model | Artificial Analysis Intelligence Index [10][11][12] | Arena text score / rank, 2026-10-02 [19] |
|---|---|---|
| Claude Opus 5.5 (max) | 58 | — |
| Claude Sonnet 5.5 (max / xhigh) | 56 | 1471 / #45 |
| GPT-6.1 Sol (max) | 52 | 1483 / #21 |
| **Claude Haiku 5.5 (max)** | **43** (#2 of 182 in its price class; 243 tok/s) | not yet ranked (released 2026-10-07) |
| Gemini 3.8 Flash (high) | 41 | 1495 / #8 |
| DeepSeek V4.1 Flash | 39 | 1474 / #38 |
| GPT-6 Luna (max) | 38 (#8 of 182; 108 s time-to-first-token, verbose) | 1443 / #90 |
| Mistral Large 4 | 38 | — (Large 3: #141) |
| Gemini 3.5 Flash-Lite | 22 | 1455 / #71 |
| Claude Haiku 4.5 | — | 1414 / #142 |

How to read this table:
- **Two different measures.** Artificial Analysis measures task accuracy. Arena measures chat preference. On Arena, Gemini 3.8 Flash ranks well above both Luna and Haiku 4.5.
- **Haiku 5.5's score is from launch day.** Expect it to move.
- **The leaderboard summary was noisy.** The fetched summary listed blended prices that disagree with the per-model pages (for example "$0.0045/1M" for Luna), so only the index scores are used here. Prices come from the vendor pages.
- **Vendor-claimed benchmarks for Haiku 5.5** [5]:
  - GDPval-AA v2.1: 1620 Elo (Haiku 4.5: 735)
  - OSWorld 2.1: 72.4% (15.7%)
  - Humanity's Last Exam, no tools: 45.9% (10.2%)
  - Anthropic also claims it "outperforms GPT-6 Luna on most benchmarks tested". That is *vendor-claimed*. Artificial Analysis's independent 43 vs 38 points the same way.
- **Luna release date conflict.** OpenAI's model page says GPT-6 Luna was released 2026-05-18 [8]. Artificial Analysis says September 2026 [12]. The vendor page wins.

---

## 4. Data handling (matters: buyer PII, application answers)

| Provider | Trains on API data? | Default retention | Notes |
|---|---|---|---|
| Anthropic API | No, unless you opt in (for example, feedback buttons) [20] | Inputs and outputs deleted within 30 days. Exceptions: usage-policy violations (up to 2 years) and Files API [21] | ZDR by agreement. `inference_geo: "us"` costs 1.1× [1] |
| OpenAI API | No, since 2023-03-01, unless you opt in [15] | Abuse-monitoring logs up to 30 days [15] | ZDR needs approval. Data residency in US, EU and others [15] |
| Google Gemini API | **Free tier: yes, "used to improve our products"**. Paid tier: no [9] | **UNVERIFIED** | Never send buyer data on the free tier |
| DeepSeek | Policy allows training, with an opt-out right [16] | — | Data "stored in People's Republic of China" [16]. Whether this policy covers the API as well as the app is **UNVERIFIED** |

**Implication.** Sending buyer or applicant data to a provider introduces a sub-processor, which affects the spec 023 privacy policy and DPA. The [agent access note](./2026-10-05-agent-store-access.md) raised the same issue. For a first release, use only **organizer-authored content** such as event text and images. Application answers are applicant-authored and may contain PII; exclude them, along with buyer data, until counsel updates the privacy policy and processor terms.

---

## 5. Illustrative monthly cost

These figures are assumptions, not measurements. The estimate covers about 50 active orgs over one month, at standard prices, with no long-context surcharge (every prompt is under 100k tokens).

| Job | Volume | Tokens per request (input / output) | Haiku 5.5 | Sonnet 5.5 | Gemini 3.8 Flash | GPT-6 Luna |
|---|---|---|---|---|---|---|
| Event / blog / page copy | 2,000 | 2,000 / 1,500 (incl. thinking) | $1.90 | $38.00 | $14.25 | $1.90 |
| Gallery alt text | 20,000 images | ~1,900 (image + prompt) / 150 | $5.30 (batch: **$2.65**) | $106.00 | $39.75 | $5.30 |
| Application summaries | 5,000 | 3,000 / 400 | $2.50 | $50.00 | $18.75 | $2.50 |
| Support Q&A | 10,000 | 1,000 fresh + 3,000 cached / 500 | $3.80 | $73.00 | $28.50 | $3.80 |
| **Total** | | | **$13.50** | $267 | $101 | $13.50 |

**Recommended mix:** Sonnet 5.5 for copy, plus Haiku 5.5 for everything else, with alt text batched. That comes to about **$47/month**.

How the estimate was built:
- **Image tokens.** The figure of ~1,600 tokens for a ~1,100 px image is an approximation and is **UNVERIFIED** for the new tokenizer. Measure it with `count_tokens`.
- **Spend caps.** Anthropic's Start tier caps spend at $500/month, with 1,000 RPM and 2M input tokens per minute per model [22]. That is ample for this load. New organizations may begin on a lower "Evaluation" tier [22].

---

## 6. Integration sketch (no code changes made)

- **One service:** `backend/src/services/AiService.js`. It exposes task-level methods: `draftEventDescription`, `altTextFor(fileId)`, `summarizeApplication`, `answerSupportQuestion`. Each method picks a model through a per-task constant, so changing a model is a one-line edit.
- **One dependency:** `@anthropic-ai/sdk`, installed from the repo root per AGENTS.md. Whether the current SDK version supports CommonJS `require` is **UNVERIFIED**; check before installing.
- **Secrets:**
  - `ANTHROPIC_API_KEY` in `backend/.env` and Railway, and nowhere else. The frontend never calls the provider. It calls Jump routes behind `requireAuth` → `requireOrgMembership`.
  - An `AI_FEATURES_ENABLED` flag keeps the integration dark, following the existing `*_ENABLED` convention.
- **Structured output:** use `output_config.format` (JSON schema) for extraction and summaries [6]. Generated HTML still goes through `sanitizeHtml.js` on write, per Gotcha 20.
- **Alt text:** send the `StoreFile` image by hash-protected URL or as base64. Use the Batches API for backfills and the synchronous API on upload.
- **Cost guards:**
  - per-org rate limit through the existing `makeLimiter`;
  - log `usage` per call on an `AiUsage` row or in logs;
  - a monthly spend limit set in the Anthropic Console [22].
- **Tests:** CI stays deterministic (no network). Mock the SDK in contract tests the same way Stripe is pinned.
- **Fallback:** keep task prompts provider-neutral, so a `gpt-6-luna` adapter can be added later if needed. Don't build that adapter now.

---

## 7. Open questions

1. Does Haiku 5.5's alt-text quality on real RRG gallery photos hold up at `effort: "low"`? Run a 30-image eval before the gallery spec commits.
2. Is Sonnet 5.5 worth 20× the cost for event copy, or does Haiku 5.5 at `high` effort suffice? Compare them blind.
3. When does buyer PII (support Q&A about orders) enter prompts? That gates on the spec 023 privacy-policy and sub-processor update.
4. Gemini 3.8 Flash's context window and the Gemini paid-tier retention period were not confirmed.

---

## Sources (all accessed 2026-10-07)

1. Anthropic pricing — https://platform.claude.com/docs/en/about-claude/pricing
2. Anthropic models overview — https://platform.claude.com/docs/en/about-claude/models/overview
3. Claude Haiku 5.5 model page — https://platform.claude.com/docs/en/models/haiku-5-5/overview
4. Claude Sonnet 5.5 model page — https://platform.claude.com/docs/en/models/sonnet-5-5/overview
5. Claude Haiku 5.5 announcement (vendor benchmarks) — https://www.anthropic.com/claude-haiku-5-5
6. Anthropic structured outputs (supported models, GA) — https://platform.claude.com/docs/en/build-with-claude/structured-outputs
7. OpenAI API pricing — https://developers.openai.com/api/docs/pricing (openai.com/api/pricing returned 403)
8. OpenAI models — https://developers.openai.com/api/docs/models
9. Gemini API pricing (incl. free vs paid data use) — https://ai.google.dev/gemini-api/docs/pricing
10. Artificial Analysis leaderboard — https://artificialanalysis.ai/leaderboards/models
11. Artificial Analysis: Claude Haiku 5.5 — https://artificialanalysis.ai/models/claude-haiku-5-5
12. Artificial Analysis: GPT-6 Luna — https://artificialanalysis.ai/models/gpt-6-luna
13. Gemini models — https://ai.google.dev/gemini-api/docs/models
14. DeepSeek pricing — https://api-docs.deepseek.com/quick_start/pricing
15. OpenAI "Your data" — https://developers.openai.com/api/docs/guides/your-data
16. DeepSeek privacy policy — https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html
17. xAI models — https://docs.x.ai/docs/models
18. Mistral pricing — https://mistral.ai/pricing (per-model prices for Small/Medium not shown: **UNVERIFIED**)
19. Arena text leaderboard (updated 2026-10-02) — https://arena.ai/leaderboard/text
20. Anthropic: is my data used for training — https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training
21. Anthropic: data retention — https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
22. Anthropic rate limits and spend caps — https://platform.claude.com/docs/en/api/rate-limits
