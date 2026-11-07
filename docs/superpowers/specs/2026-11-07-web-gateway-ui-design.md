# Web Gateway UI Design (EMO.ai)

## Intent
Convert the existing `arena-web-api`/webbridge into a simple local gateway that is easy to start from Terminal and manage in a browser. The focus is **web-provider management** (Arena browser, ZAI web, Claude web, Tencent AI Studio web, Gemini web, Qwen web), not a multi-user admin system.

## Why
The project already supports several web-backed providers through Playwright profiles and explicit model prefixes, but configuration is env/CLI-driven and there is no local control plane for enabling providers, selecting models, or observing runtime/usage.

## Goals
- Start/open the gateway and UI easily from Terminal with `EMO.ai`.
- Provide a browser UI to manage web providers (no login/accounts, no admin users).
- Per web provider: settings, model list/selection, runtime status/duration, start/stop.
- Pull/refresh models per provider where possible; allow manual model IDs for web UIs that cannot be fully discovered.
- Expose only selected/enabled models through `/v1/models` and route only enabled providers/models.
- Show outputs: `base uri: mac.ai/v1`, `api: mac`.
- Track usage since gateway/runtime session and reset the session counter when the browser UI closes (heartbeat-based).
- Keep OpenAI-compatible `/v1/chat/completions` and `/v1/models`.

## Non-goals (v1)
- Multi-user accounts, roles, admin login, or remote access controls beyond local defaults.
- Automatic `/etc/hosts` modification for `mac.ai` (provide instructions only).
- Full native macOS `.app` packaging/Electron/Tauri (approach C chosen).
- Guaranteed complete model discovery for every web UI (some providers require presets/manual IDs).
- Billing-accurate token metering for web-scraped providers (usage is best-effort counters).

## Anti-goals
- Exposing secrets in logs/UI responses.
- Breaking existing explicit model-prefix routing behavior.

## Constraints
- macOS local workflow; Playwright uses real Chrome profiles for web providers.
- Web providers may require headed/manual login/captcha/2FA; UI must surface login/profile guidance, not automate restricted verification.
- Browser-close detection is not perfectly reliable; use heartbeat + timeout and label as session reset.
- Existing codebase is TypeScript/Fastify/Playwright (`arena-web-api`).

## Chosen Approach
**C (chosen):** CLI-launched local gateway with browser management UI. No macOS Applications `.app` bundle. A `EMO.ai` command/script starts the server and opens the UI.

Alternatives considered:
- **A:** Browser UI + local launcher `.app`; better desktop convenience but more packaging work than requested now.
- **B:** Tauri/Electron desktop app; highest complexity and stack change.

## User-facing Behavior
### Command
- `EMO.ai` (project script/executable entry) starts the gateway on localhost and opens the default browser to the management UI.
- Terminal remains attached by default (`Ctrl+C` stops gateway). UI may offer a stop action.

### Management UI
- Simple single-page/local UI (path `/` or `/ui`; no `/admin` concept/user system).
- Global section:
  - gateway status, started at, uptime
  - `base uri: mac.ai/v1` (display)
  - `api: mac` (display)
  - session usage counter (requests, completions, errors, streaming requests; optional bytes/chars best-effort) since gateway session; resets when UI heartbeat stops
  - start/stop gateway controls as applicable
- Per-provider sections (web providers):
  - provider name/type, enabled flag, selected models only
  - settings: base URL/profile path/headless/timeout where relevant; safe display of configured values
  - models: pulled/discovered + manual entries; checkboxes for enabled models
  - runtime: stopped/starting/running/error, startedAt, runtime duration, last error
  - actions: start, stop, refresh/pull models, open/login hint (uses existing login scripts/profiles)

### OpenAI-compatible API
- `GET /v1/models` returns only models selected/enabled by configuration (plus any required compatibility behavior decided in implementation; default: selected only).
- `POST /v1/chat/completions` routes to enabled providers; rejects disabled/unselected targets with clear errors.
- Auth default: require API key `mac` via `Authorization: Bearer mac` or `x-api-key: mac` for `/v1/*` (configurable later; v1 default as requested).

### mac.ai/v1
- Gateway binds localhost (default `127.0.0.1:8989`).
- UI displays canonical base URI `mac.ai/v1`.
- Docs/UI note: optional local mapping `127.0.0.1 mac.ai` in `/etc/hosts`; not modified automatically.

## Architecture / Components
- **Provider Manager (new):** owns provider configs, runtime state, driver instances/lifecycle (`start`, `stop`, `refreshModels`, `status`), and selected-model filtering. Replaces fixed-at-boot routing for managed web providers.
- **Config Store (new):** reads/writes `~/.arena-webbridge/gateway.json` (validated schema/defaults, atomic write). Stores enabled providers, selected models, provider settings, UI/API preferences.
- **Gateway Server (extended Fastify):** serves `/v1/*`, management UI static assets, and management API (local-only). Adds auth middleware for `/v1/*`.
- **Usage Tracker (new):** in-memory counters; records request lifecycle from `/v1/chat/completions`; exposes snapshot over management API/SSE; session reset when heartbeat expires.
- **EMO.ai launcher (new):** script/CLI entry that loads config, starts gateway, prints outputs (`base uri`, `api`), and opens browser.

## Data Model (v1 sketch)
```json
{
  "gateway": {
    "port": 8989,
    "host": "127.0.0.1",
    "baseUriDisplay": "mac.ai/v1",
    "apiKey": "mac",
    "requireApiKey": true
  },
  "ui": { "heartbeatTimeoutMs": 15000 },
  "providers": {
    "claude-web": {
      "enabled": true,
      "running": false,
      "settings": { "userDataDir": "...", "baseUrl": "...", "headless": false, "timeoutMs": 300000 },
      "availableModels": ["claude-web:default"],
      "selectedModels": ["claude-web:default"]
    }
  }
}
```
Runtime-only fields (status, startedAt, uptime, lastError, usage counters) are not persisted except optional last-known metadata.

## Risks / Calls (v1)
- **Driver lifecycle:** start/stop implemented via manager constructing/closing provider drivers/contexts; first implementation may serialize per-provider operations.
- **Model discovery:** `refresh/pull` uses provider `listModels()` and merges manual entries; UI clearly labels discovered vs manual.
- **Heartbeat reset:** if UI never opens, session counter can remain at startup state or use gateway lifetime semantics; implementation should be explicit.
- **Security:** no admin users, but local machine access can use the UI/API. Keep management API bound to localhost by default.
- **`mac.ai`:** display/instruction only; do not require or perform privileged host-file edits.

## Implementation Slices
1. Config store + provider state model.
2. Provider manager with dynamic start/stop and selected-model filtering.
3. API key auth + usage tracking + heartbeat endpoints.
4. Management UI (dashboard, per-provider cards, model selection).
5. `EMO.ai` launcher and docs.

## Approval
User confirmed: approach C; no admin/users; implement as a simple local app/UI for web-provider management. Needs explicit approval of this design before implementation begins.
