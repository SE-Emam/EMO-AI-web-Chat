# Web Gateway UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local browser-managed gateway for web providers launched by `EMO.ai`, with persisted config, per-provider start/stop/model selection, OpenAI `/v1/*` auth/usage tracking, and a no-login management UI.

**Architecture:** Extend the existing Fastify/TypeScript/Playwright app with a file-backed config store (`~/.arena-webbridge/gateway.json`), a `ProviderManager` that owns web-provider runtime state and driver lifecycles, and a `UsageTracker` with heartbeat-based session reset. `createServer()` becomes gateway-aware while preserving a compatibility path for existing tests that pass a mock `ArenaDriver`. The management UI is a small static HTML/CSS/JS page served by Fastify and backed by localhost-only management endpoints.

**Tech Stack:** Node.js ESM, TypeScript 5, Fastify 5, Playwright 1.50, Vitest 3, existing `ArenaDriver` implementations in `src/arena/*`.

**Spec:** `docs/superpowers/specs/2026-11-07-web-gateway-ui-design.md`

## Global Constraints

- No admin users/accounts/login system. Management UI is local and unauthenticated by user identity.
- Focus v1 on web providers: Arena browser, ZAI web, Claude web, Tencent AI Studio web, Gemini web, Qwen web.
- Do not modify `/etc/hosts` automatically. Display `base uri: mac.ai/v1` and provide instructions only.
- Default `/v1/*` API key is `mac`, accepted as `Authorization: Bearer mac` or `x-api-key: mac`; behavior must be configurable.
- Only enabled + selected models are returned by managed `/v1/models` and routable by managed `/v1/chat/completions`.
- Session usage counter resets when browser UI heartbeat stops/timeout; this is best-effort and must not affect `/v1` correctness.
- Preserve explicit provider model-prefix routing safety (e.g. `gemini-web:`/`geminiweb:` only, not plain `gemini-*`).
- Keep existing test patterns viable; update tests whose assumptions intentionally change (e.g. `/v1` auth now enforced by default in gateway mode) with explicit setup.

## Review Focus

- `/v1/*` with missing/wrong API key in gateway mode → `401` JSON error, never upstream provider work.
- `/v1/models`/chat requesting a disabled or unselected model → clear `400`/`404`-style API error, no fallback to a disabled provider.
- Browser heartbeat absent before first heartbeat, or after timeout → session counter resets/represents reset state without crashing or blocking `/v1`.
- Provider start failure (bad profile/login needed) → provider state becomes `error` with message; gateway and other providers remain usable.
- Repeated start/stop/refresh on same provider → no leaked browser contexts/process pile-up; serialized per provider.
- Legacy `createServer(mockDriver)` tests still run with explicit test config (auth disabled or key `mac` where appropriate).

---

## File Structure

- Create `src/gateway/types.ts` — gateway config, provider IDs, runtime state, usage, API shapes.
- Create `src/gateway/config-store.ts` — load/save/merge defaults for `~/.arena-webbridge/gateway.json` (atomic write).
- Create `src/gateway/usage-tracker.ts` — lifetime/session counters, heartbeat timeout, request recording.
- Create `src/gateway/provider-manager.ts` — provider definitions, dynamic driver factory/lifecycle, selected-model filtering, status snapshots.
- Create `src/gateway/ui.ts` — serves embedded management UI HTML and static JS/CSS strings/endpoints.
- Create `src/server/gateway-routes.ts` — management API handlers (`/api/gateway/*`) using manager/tracker/config store.
- Modify `src/server/app.ts` — accept legacy driver or gateway context; add `/v1` auth, usage hooks, UI/management routes.
- Modify `src/cli.ts` — add `gateway`/`emo` launcher behavior and preserve existing commands.
- Create `src/emo-ai.ts` — CLI entry that starts gateway and opens browser.
- Modify `src/index.ts` and `package.json` — export/bin/script for `EMO.ai`.
- Create `scripts/EMO.ai` — shell launcher for Terminal/PATH use.
- Create `tests/gateway/config-store.test.ts`
- Create `tests/gateway/usage-tracker.test.ts`
- Create `tests/gateway/provider-manager.test.ts`
- Create `tests/gateway/server-auth-usage.test.ts`
- Modify `tests/e2e.test.ts` and `tests/server.test.ts` only as needed for explicit auth compatibility.

## Interfaces

```ts
// src/gateway/types.ts
export type WebProviderId = 'arena-browser' | 'zai-web' | 'claude-web' | 'tencent-ai-web' | 'gemini-web' | 'qwen-web';
export type ProviderStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface GatewayConfigFile { gateway: { port: number; host: string; baseUriDisplay: string; apiKey: string; requireApiKey: boolean }; ui: { heartbeatTimeoutMs: number }; providers: Partial<Record<WebProviderId, ProviderConfig>> }
export interface ProviderConfig { enabled: boolean; settings: Record<string, unknown>; availableModels: string[]; selectedModels: string[] }
export interface ProviderRuntimeState { id: WebProviderId; status: ProviderStatus; startedAt?: string; lastStartedAt?: string; lastStoppedAt?: string; runtimeMs: number; lastError?: string; selectedModels: string[]; availableModels: string[]; enabled: boolean }
export interface UsageSnapshot { gatewayStartedAt: string; sessionActive: boolean; sessionResetAt?: string; lifetime: UsageCounters; session: UsageCounters }
export interface UsageCounters { requests: number; chatRequests: number; streamRequests: number; completions: number; errors: number; promptChars: number; completionChars: number }
```

```ts
// src/gateway/config-store.ts
export class GatewayConfigStore {
  constructor(filePath?: string)
  get path(): string
  async load(): Promise<GatewayConfigFile>
  async save(config: GatewayConfigFile): Promise<void>
}
export function defaultGatewayConfig(): GatewayConfigFile
```

```ts
// src/gateway/usage-tracker.ts
export class UsageTracker {
  constructor(opts?: { heartbeatTimeoutMs?: number; now?: () => number })
  heartbeat(): void
  snapshot(now?: number): UsageSnapshot
  recordRequestStart(input: { model: string; stream: boolean; promptChars: number }): void
  recordRequestEnd(input: { ok: boolean; completionChars?: number }): void
}
```

```ts
// src/gateway/provider-manager.ts
export class ProviderManager {
  constructor(opts: { store: GatewayConfigStore; config: GatewayConfigFile; now?: () => number })
  async init(): Promise<void>
  async start(id: WebProviderId): Promise<ProviderRuntimeState>
  async stop(id: WebProviderId): Promise<ProviderRuntimeState>
  async refreshModels(id: WebProviderId): Promise<ProviderRuntimeState>
  async updateProvider(id: WebProviderId, patch: { enabled?: boolean; settings?: Record<string, unknown>; selectedModels?: string[]; availableModels?: string[] }): Promise<ProviderRuntimeState>
  listStates(): ProviderRuntimeState[]
  getState(id: WebProviderId): ProviderRuntimeState
  getActiveDriver(): ArenaDriver // routes only enabled/selected provider models
  getConfig(): GatewayConfigFile
  async saveConfig(): Promise<void>
  async close(): Promise<void>
}
```

---

### Task 1: Gateway Config Types and File Store

**Files:**
- Create: `src/gateway/types.ts`
- Create: `src/gateway/config-store.ts`
- Test: `tests/gateway/config-store.test.ts`

- [ ] **Step 1: Write the failing config-store tests**
  - Test `defaultGatewayConfig()` returns `gateway.baseUriDisplay === 'mac.ai/v1'`, `gateway.apiKey === 'mac'`, `gateway.requireApiKey === true`, and includes provider entries for all 6 web provider IDs with safe defaults.
  - Test `load()` returns defaults when file is missing.
  - Test `save()` then `load()` round-trips selected models/settings; saved JSON contains no runtime fields like `status`, `runtimeMs`.
  - Test corrupted JSON falls back to defaults without throwing out of the API contract (or throws a typed error the server maps clearly — pick one and assert it). Prefer: `load()` returns defaults and leaves an optional warning path; assert returned config is valid.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `cd /Users/emamabdullaziz/Desktop/web && PATH="/Users/emamabdullaziz/.nvm/versions/node/v26.7.0/bin:$PATH" npx vitest run tests/gateway/config-store.test.ts -v`
  - Expected: FAIL (module not found / missing exports).

- [ ] **Step 3: Implement types and config store**
  - `types.ts`: define IDs/config/runtime/usage interfaces exactly enough for tasks 2-4.
  - `config-store.ts`: resolve `~`/default path `~/.arena-webbridge/gateway.json`; `load()` reads if exists else defaults; merge partial file over defaults so new providers/settings appear; `save()` writes atomically (`write temp + rename`).
  - Default provider settings should mirror existing defaults where known: Claude `~/.arena-webbridge/claude-profile`, Gemini `gemini-profile`, Qwen `qwen-profile`, Tencent `tencent-ai-profile`, ZAI web `zai-profile`, Arena uses existing `userDataDir`/base URL/headless.

- [ ] **Step 4: Run tests to verify pass**
  - Run same command. Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add src/gateway/types.ts src/gateway/config-store.ts tests/gateway/config-store.test.ts`
  - `git commit -m "feat(gateway): add config types and file-backed store"`

### Task 2: Usage Tracker with Browser Heartbeat Reset

**Files:**
- Create: `src/gateway/usage-tracker.ts`
- Test: `tests/gateway/usage-tracker.test.ts`

- [ ] **Step 1: Write failing usage-tracker tests**
  - Test `recordRequestStart/End` increments lifetime and session counters (requests, chatRequests, streamRequests, completions, errors, promptChars, completionChars).
  - Test `heartbeat()` marks session active; `snapshot(now > lastHeartbeat + timeout)` returns `sessionActive === false` and resets session counters to zero while lifetime remains.
  - Test first snapshot before any heartbeat is explicit (choose deterministic behavior: `sessionActive false`, session zeroed, `sessionResetAt`/started semantics documented in test).
  - Test reset happens once per expired session until next heartbeat.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `... npx vitest run tests/gateway/usage-tracker.test.ts -v`

- [ ] **Step 3: Implement `UsageTracker`**
  - Accept injected `now()` for tests. Store lifetime counters always; store session counters and last heartbeat/reset markers.
  - `snapshot()` computes expiry and applies lazy reset before returning.

- [ ] **Step 4: Run tests to verify pass**

- [ ] **Step 5: Commit**
  - `git add src/gateway/usage-tracker.ts tests/gateway/usage-tracker.test.ts`
  - `git commit -m "feat(gateway): add usage tracker with heartbeat session reset"`

### Task 3: Provider Manager and Dynamic Model Filtering

**Files:**
- Create: `src/gateway/provider-manager.ts`
- Test: `tests/gateway/provider-manager.test.ts`

- [ ] **Step 1: Write failing provider-manager tests with fake drivers**
  - Use tiny fake `ArenaDriver` implementations (no Playwright). Assert:
    - `listStates()` returns all web providers.
    - `updateProvider(id, { selectedModels, availableModels, enabled })` persists in memory and `getConfig()` reflects patch.
    - `getActiveDriver().listModels()` returns only selected models from enabled providers; duplicates removed.
    - `getActiveDriver().sendMessage()` rejects unselected/disabled model with clear error containing `not enabled` or `not selected`.
    - `start()` sets status `starting`→`running` (or running after init) and `stop()` closes driver and sets `stopped`; fake driver records `close()` calls.
    - `refreshModels()` uses driver `listModels()` and merges into `availableModels` without dropping manual selected entries.
    - concurrent `start()` calls for same provider serialize (second waits/returns stable state; only one driver created) — use a deferred fake driver.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `... npx vitest run tests/gateway/provider-manager.test.ts -v`

- [ ] **Step 3: Implement `ProviderManager`**
  - Define provider registry metadata: id, display name, default prefixes/match behavior, factory from settings/config.
  - Factories construct existing drivers: `ArenaDriver` (arena browser via `BrowserManager`? inspect constructor; use existing config path), `ZaiWebDriver`, `ClaudeWebDriver`, `TencentAiWebDriver`, `GeminiWebDriver`, `QwenWebDriver`. For Arena browser, prefer `src/arena/driver.ts` `ArenaDriver` class.
  - Keep a per-provider mutex/promise queue. Track runtime state separately from persisted config.
  - `getActiveDriver()` returns a lightweight `ArenaDriver` wrapper that consults current enabled+selected state and delegates to running/created drivers using explicit prefix/match rules. Do not fall through to disabled providers.
  - `saveConfig()` delegates to store using current config snapshot (no runtime fields).
  - `close()` stops all running providers.

- [ ] **Step 4: Run tests to verify pass**

- [ ] **Step 5: Commit**
  - `git add src/gateway/provider-manager.ts tests/gateway/provider-manager.test.ts`
  - `git commit -m "feat(gateway): add provider manager with dynamic lifecycle and model filtering"`

### Task 4: Gateway HTTP Auth, Usage Hooks, and Management API

**Files:**
- Create: `src/server/gateway-routes.ts`
- Create: `src/gateway/ui.ts`
- Modify: `src/server/app.ts`
- Test: `tests/gateway/server-auth-usage.test.ts`
- Modify as needed: `tests/server.test.ts`, `tests/e2e.test.ts`

- [ ] **Step 1: Write failing server/auth/usage tests**
  - New `tests/gateway/server-auth-usage.test.ts`:
    - Build server in gateway mode with fake manager/tracker/config (`requireApiKey true`, key `mac`).
    - `POST /v1/chat/completions` without key → 401; with `Authorization: Bearer mac` → 200/non-401 from fake driver; with `x-api-key: mac` → accepted.
    - `GET /v1/models` without key → 401.
    - `POST /api/gateway/heartbeat` updates tracker; `GET /api/gateway/status` returns provider states, config display (`baseUriDisplay`, `apiKey` masked or shown per local-UI decision — choose show `mac` as requested display data, but keep response local-only) and usage snapshot.
    - `GET /` or `/ui` serves HTML containing `mac.ai/v1` and provider management markers.
  - Update legacy tests if needed: pass `gateway: { requireApiKey: false }` / config override so existing mock-driver tests that do not send `mac` still pass; prefer compatibility default in legacy `createServer(driver)` path to avoid broad breakage.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `... npx vitest run tests/gateway/server-auth-usage.test.ts tests/server.test.ts tests/e2e.test.ts -v`

- [ ] **Step 3: Implement server integration**
  - `src/server/app.ts`: introduce `createServer` overload/union: legacy `(driver, config?)` and gateway `({ manager, tracker, store, config })`. Legacy path defaults `requireApiKey` false for backward compatibility unless explicitly enabled.
  - Add `/v1/*` auth pre-handler/hook. Exempt non-`/v1` paths.
  - Wrap chat completion handling to record usage start/end; count prompt chars from messages and completion chars from final/streamed response.
  - Register management routes from `gateway-routes.ts` and UI routes from `ui.ts`.
  - `ui.ts`: return a self-contained HTML page (inline CSS/JS) implementing dashboard + per-provider cards using management API. Keep it simple, no build step. Include heartbeat timer (`setInterval` POST `/api/gateway/heartbeat`), provider start/stop/refresh/save actions, model checkboxes/manual add, runtime display, and outputs `base uri: mac.ai/v1`, `api: mac`.
  - `gateway-routes.ts`: endpoints (all localhost JSON): `GET /api/gateway/status`, `POST /api/gateway/heartbeat`, `POST /api/gateway/providers/:id/start|stop|refresh`, `PATCH /api/gateway/providers/:id`, `POST /api/gateway/save`, `POST /api/gateway/shutdown` (optional, local-only). Validate provider IDs.

- [ ] **Step 4: Run tests to verify pass**
  - Run targeted gateway/server/e2e tests.

- [ ] **Step 5: Commit**
  - `git add src/server/app.ts src/server/gateway-routes.ts src/gateway/ui.ts tests/gateway/server-auth-usage.test.ts tests/server.test.ts tests/e2e.test.ts`
  - `git commit -m "feat(gateway): add auth, usage heartbeat, management API, and local UI"`

### Task 5: EMO.ai Launcher and CLI Integration

**Files:**
- Create: `src/emo-ai.ts`
- Create: `scripts/EMO.ai`
- Modify: `src/cli.ts`
- Modify: `package.json`
- Modify: `README.md` (brief section)
- Test: `tests/gateway/launcher.test.ts` (lightweight; command/help/open behavior mocked)

- [ ] **Step 1: Write failing launcher/help test**
  - Assert `node dist/emo-ai.js --help` or equivalent prints EMO.ai/gateway usage and mentions `mac.ai/v1`/management UI.
  - If testing `scripts/EMO.ai`, ensure it is executable and forwards to node entry.

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement launcher**
  - `src/emo-ai.ts`: load/store config, create tracker/manager, create gateway server, listen on configured host/port, print:
    ```text
    EMO.ai gateway ready
    base uri: mac.ai/v1
    api: mac
    ui: http://127.0.0.1:<port>/
    ```
    open browser using `open` on macOS (`child_process.spawn('open', [url], { stdio: 'ignore', detached: true })`). Handle SIGINT/SIGTERM by closing manager/server.
  - `scripts/EMO.ai`: shell wrapper resolving project dir and running `node dist/emo-ai.js` (or tsx in dev) with passed args.
  - `package.json`: add bin `"EMO.ai": "./dist/emo-ai.js"` if compatible; also add script `"emo": "tsx src/emo-ai.ts"` for dev convenience. Keep existing bins.
  - `src/cli.ts`: optional `gateway` command delegating to same launcher logic (nice-to-have; do not break existing commands).
  - `README.md`: add short “EMO.ai local gateway UI” section with start command, outputs, and optional `/etc/hosts` note.

- [ ] **Step 4: Run tests/build to verify pass**
  - Run: `... npm run build && npm test`

- [ ] **Step 5: Commit**
  - `git add src/emo-ai.ts scripts/EMO.ai src/cli.ts package.json README.md tests/gateway/launcher.test.ts`
  - `git commit -m "feat(gateway): add EMO.ai launcher and local management workflow"`

---

## Verification Checklist (after all tasks)

- [ ] `cd /Users/emamabdullaziz/Desktop/web && PATH="/Users/emamabdullaziz/.nvm/versions/node/v26.7.0/bin:$PATH" npm run build`
- [ ] `PATH="/Users/emamabdullaziz/.nvm/versions/node/v26.7.0/bin:$PATH" npm test`
- [ ] Manual smoke: start `EMO.ai`/`node dist/emo-ai.js`, confirm UI opens, outputs show `mac.ai/v1` and `mac`, heartbeat counter resets after closing UI tab (wait timeout), provider cards render.
- [ ] Manual `/v1` auth: request without key fails; with `Authorization: Bearer mac` succeeds for an enabled/selected provider.
- [ ] `/v1/models` returns only selected models.

## Execution Handoff

After the user reviews this plan, choose execution method before implementation (subagent-driven vs native), per writing-plans skill.
