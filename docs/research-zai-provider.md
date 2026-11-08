# Research: Z.AI (Zhipu AI) as a second backend for arena-web-api

Date: 2026-11-07 · Sources: official docs `docs.z.ai` (API reference, pricing, rate limits, quick-start,
OpenAI SDK guide) and `docs.bigmodel.cn` (Chinese platform). Web search was unavailable; everything below
came from official documentation fetched directly. No project files were modified.

---

## 1. Platform landscape (which "platform" is which)

| Platform | Domain | Audience | API base |
| --- | --- | --- | --- |
| Z.AI international | `z.ai` / `docs.z.ai` | English / international | `https://api.z.ai/api/paas/v4/` |
| BigModel (Zhipu) CN | `open.bigmodel.cn` / `docs.bigmodel.cn` | Chinese | `https://open.bigmodel.cn/api/paas/v4/` |
(z.ai is the international variant of the BigModel platform; both expose a `/paas/v4/` API shape.)

As of Oct 16, 2026, Z.AI splits key management: **standard model API keys** and **GLM Coding Plan keys**
are separate key types and are billed separately (`docs.z.ai/devpack/notice/api-key-management`).

## 2. Exact API endpoint(s) & auth

- **Chat completions (OpenAI-compatible):**
  `POST https://api.z.ai/api/paas/v4/chat/completions`
- **SDK base URL** (for `OpenAI({ baseURL, apiKey })`, official supported usage):
  `https://api.z.ai/api/paas/v4/` (trailing slash, per docs examples)
- **Auth:** `Authorization: Bearer <API_KEY>` — API keys created at
  `https://z.ai/manage-apikey/apikey-list`; billing/recharge at `https://z.ai/manage-apikey/billing`;
  per-account rate limits viewable at `https://z.ai/manage-apikey/rate-limits`.
- **Request extras** (not OpenAI, passed via `extra_body`/raw JSON): `thinking` (`{type: enabled|disabled}`,
  GLM-5.3/5.3-Flash only support `enabled`; thinking depth via `reasoning_effort`), `reasoning_effort`
  (`low|high|max` for 5.3/5.3-flash), `do_sample`, `tool_stream`, `user_id`, `request_id`.
- **Important compatibility quirks** (documented in the OpenAI-compat guide):
  - `temperature` range is **[0.0, 1.0]** (not 0–2); `temperature=0`/`do_sample=false` is **not** applicable
    through OpenAI-SDK calls.
  - `response_format` supports `text` / `json_object` only (strict `json_schema` not documented here).
  - Streaming is standard SSE ending with `data: [DONE]`; reasoning appears as `reasoning_content`.
  - GLM-5.3-Flash: `thinking` is always on; recommended `temperature: 1`, `top_p: 0.95`,
    `reasoning_effort: max`.

## 3. Model IDs (international z.ai)

Text-only chat completions enum: `glm-5.3`, `glm-5.2`, `glm-5.1`, `glm-5`, `glm-4.7`, `glm-4.6`
Multimodal (vision/video/file) enum: `glm-5.3-flashx`, `glm-5.3-flash`, `glm-5.3-flashx-legal`

Notes:
- **`glm-5.3-flash`** — the same ID shown in arena.ai's UI. 320B total / 18B activated, 1M-token context,
  128K max output, native multimodal (image/video/file/text input), function calling, thinking always on.
  This is the ideal default for our bridge (cheapest, 3×-quota on Coding Plan, multimodal).
- Legacy/other: `glm-4.7-flash`, `glm-4.5-flash`, `glm-4.6v-flash` exist and are **$0** (see §4).
- Note: model codes are lowercase as listed.

## 4. Free tier / pricing (international z.ai)

Pricing per 1M tokens (USD), from `docs.z.ai/guides/overview/pricing`:

| Model | Input | Cached input | Output |
| --- | --- | ---: | ---: |
| GLM-5.3 | $1.40 | $0.26 | $4.40 |
| **GLM-5.3-Flash** | **$0.15** | $0.03 | **$0.50** |
| GLM-5.3-FlashX | $0.37 | $0.075 | $1.25 |
| GLM-5.2 / 5.1 | $1.40 | $0.26 | $4.40 |
| GLM-5 | $1.00 | $0.20 | $3.20 |
| GLM-4.7 / 4.6 | $0.60 | $0.11 | $2.20 |
| **GLM-4.7-Flash / GLM-4.5-Flash / GLM-4.6V-Flash (legacy)** | **Free** | Free | **Free** |

- **No documented per-day free-request allowance** for the standard prepaid API. Accounts are
  recharge/balance-based (pay-as-you-go); the FAQ only describes recharging and billing visibility.
- **Actually free models:** the legacy flash models above are priced $0 in/out — usable for free with
  just an API key (subject to per-account concurrency limits).
- **Cache:** cached-input storage is "limited-time free" for current models; a cache hit bills ~1/5 of
  input price. (Current open beta; hit behavior not fully documented.)
- **Upgrade path:** GLM Coding Plan from **$18/month** — points-based quota; GLM-5.3-Flash consumes
  only ~⅓ of the points of GLM-5.3 ("3× the quota"); off-peak hours and all-day weekends cost 50% of
  standard points. Coding-Plan keys use a dedicated endpoint (`docs.z.ai/devpack/quick-start`).
- **Credits campaign:** invitation bonuses exist (10% of a friend's first order) but require the
  invitee to *purchase*; no documented automatic signup credit on the international platform today.
- Chinese platform (`open.bigmodel.cn`): pay-as-you-go in RMB with user "equity levels" (积分) gating
  concurrency; per-model free models also exist (free flash models). A signup RMB bonus was
  offered historically but is **not documented in the current docs** — treat as unconfirmed.

## 5. Rate limits

From `docs.bigmodel.cn/cn/api/rate-limit` (mechanism is shared across both variants):

- Limits are **concurrent-request based** (in-flight requests), **per account** and **per model**.
- Level depends on user "equity" tier (points) for prepaid API users, or Coding Plan tier
  (Lite/Pro/Max) for subscribers. Peak hours trigger dynamic throttling at the account level;
  low-peak periods get higher concurrency.
- You can view your own limits in the console (z.ai: `manage-apikey/rate-limits`; cn:
  `usercenter/proj-mgmt/rate-limits`) and request increases via a console form (10 business days).
- Error codes: `1302` = user rate limit hit; `1305` = platform overload (not your fault, retry later).
  Concrete numeric RPM/TPM numbers are **not published**; they are account-specific.

## 6. Arena.ai "glm-5.3-flash" ↔ Z.AI relationship (question 5)

- The model code `glm-5.3-flash` matches Z.AI's official model code exactly, and Zhipu actively
  distributes GLM models to third-party frontends/eval platforms (their blog notes anonymous testing
  of GLM-5.3-Flash under the alias "ox-alpha" on evaluation surfaces even before launch). So arena's
  glm-5.3-flash is **very likely** served from Zhipu/z.ai infrastructure.
- However, there is **no public documentation** on how arena.ai sources that model (direct provider
  channel, z.ai API, or reseller), and no documented way to query z.ai-backed models through arena.ai
  with relaxed limits. Critically, the `403 {"error":"recaptcha validation failed"}` banner is arena's
  *own* application-level rate limit on `/nextjs-api/stream/create-evaluation` — it is not imposed by
  Zhipu. Nothing documented suggests the limit can be reduced from the client side (they gate with
  reCAPTCHA and per-user quotas by design).
- **Conclusion:** treat arena.ai as a free-but-throttled playground; for capacity, go direct to the
  z.ai paid (or free-flash) API. Any "limit reduction" inside arena would require violating their
  anti-abuse controls — out of scope.

## 7. Verdict: can we add Z.AI behind our OpenAI-compatible bridge?

**Yes — trivially.** Z.AI is officially OpenAI-compatible (the official docs show exactly our pattern:
base-URL + key swap on the OpenAI SDK). No Playwright, auth, or reCAPTCHA involved; just a
`fetch`/streaming client. Two configs worth supporting:

- **Paid (default):** `glm-5.3-flash` at $0.15/$0.50 per MTok — cheap and effectively unlimited.
- **$0 fallback:** `glm-4.7-flash` — completely free, guards against arena outages with zero spend.

### Minimal integration plan

Config (src/config.ts, plus Config type in src/types.ts):

```ts
// new fields
zai: {
  apiKey: process.env.ZAI_API_KEY,            // optional; when set, z.ai provider is enabled
  baseUrl: 'https://api.z.ai/api/paas/v4/',   // env ZAI_BASE_URL overrideable
  defaultModel: 'glm-5.3-flash',
  modelPrefixes: ['glm-'],                    // route model IDs matching these to z.ai
}
```

New provider (no changes to existing arena driver): `src/arena/zai-driver.ts`
- Implements the same `ArenaDriver` interface our `driver.ts` already uses
  (`listModels()` + `sendMessage(model, messages, onChunk, signal)`).
- One `fetch()` POST to `${baseUrl}chat/completions` with `Authorization: Bearer <API_KEY>`; parse SSE
  `data:` lines, forward `choices[0].delta.content` strings through `onChunk`, and map
  `reasoning_content` to our chunk stream only if we want it (or drop it for chat parity).
- Enforce temperature clamp to [0, 1]; cap `max_tokens` (≤131072); set `thinking: {type:'enabled'}`.
- On z.ai error codes 1302/1305 → return a transient-retry signal; on others, propagate OpenAI-shaped
  error (they already are OpenAI-shaped).

Composite routing: a tiny wrapper driver that dispatches by model ID (prefix `glm-` → z.ai driver when
`ZAI_API_KEY` set; otherwise/fallback → existing arena driver). The composite can be injected where
`createServer` currently receives a single ArenaDriver — `src/server/app.ts` itself needs **no** route
changes (its SSE/non-SSE handling and `openai-formatter.ts` work unchanged since the onChunk contract
is plain strings). File list:

1. `src/types.ts` — extend `Config` with the `zai` block (and document interface).
2. `src/config.ts` — defaults + env parsing (`ZAI_API_KEY`, `ZAI_BASE_URL`).
3. `src/arena/zai-driver.ts` — **new**: fetch-based OpenAI→z.ai streaming driver (≈100 lines).
4. Composite dispatch wrapper + wiring in `src/cli.ts`/`src/index.ts`; `src/server/app.ts` only needs
   the dispatch hooks if we don't inject a composite driver — either way, no new routes.
5. Optional: extend the error-mapping in `src/server/app.ts` for 1302/1305 retry hints.

### Smoke tests we can run once a key exists (not done here — requires an account)

```bash
curl -sS https://api.z.ai/api/paas/v4/chat/completions \
  -H "Authorization: Bearer $ZAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"ping"}],"stream":true}'
```

- Verify: SSE deltas, `data: [DONE]`, `usage.total_tokens`, cached-token pricing fields, rate-limit
  headers/body shape on over-limit (error 1302).
