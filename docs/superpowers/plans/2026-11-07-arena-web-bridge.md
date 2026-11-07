# Arena WebBridge (arena-web-api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a robust, local OpenAI-compatible Web-to-API bridge (`arena-web-api`) for Arena (arena.ai / LMSYS Chatbot Arena) that uses a persistent real Chrome browser profile to authenticate and bypass Cloudflare, saving session state, and exposing `/v1/chat/completions` (with streaming) and `/v1/models` on port `8989` for AI agents (OpenCode, Cline, Pi, Cursor) and integration with Emo-AI-Gateway / New API.

**Architecture:** A TypeScript/Node.js service with two primary modes:
1. `login`: Launches an interactive Google Chrome window with a persistent user data directory (`~/.arena-webbridge/chrome-profile`) for the user to complete Google/GitHub/email authentication and Cloudflare Turnstile verification.
2. `serve`: Runs a Fastify HTTP server exposing OpenAI-compatible `/v1/models` and `/v1/chat/completions` (supporting SSE streaming). Under the hood, a Playwright browser worker interacts with Arena Direct Chat to select models, inject user prompts, and stream responses token-by-token.

**Tech Stack:** Node.js (v26+), TypeScript, Fastify, Playwright (`channel: 'chrome'`), Vitest/Jest for testing, Commander for CLI.

**Spec:** Direct Chat mode on `https://arena.ai/` (OpenAI API contract `/v1/chat/completions` and `/v1/models`). Compatible with Emo-AI-Gateway web-provider pattern.

## Global Constraints

- Port defaults to `8989` (configurable via `PORT` or `--port`).
- Base URL format: `http://127.0.0.1:8989/v1`.
- Browser profile lives in `~/.arena-webbridge/chrome-profile` to survive restarts and updates.
- Endpoints must conform 100% to OpenAI Chat Completion specification (`stream: true` and `stream: false`).
- Must handle Cloudflare Turnstile gracefully by using genuine Google Chrome (`channel: 'chrome'`).
- Zero telemetry or external credential leakage.

## Review Focus

1. **Cloudflare Turnstile challenge:** Browser worker must detect if Cloudflare challenge is pending and wait or prompt user rather than silently crashing.
2. **Streaming SSE protocol:** Must format chunks with `data: {"id":..., "choices":[{"delta":{"content":"..."}}]}\n\n` and terminate with `data: [DONE]\n\n`.
3. **Multi-turn conversation handling:** Must feed prior messages correctly into Arena chat or format the prompt context.
4. **Model selection fallback:** If requested model is not found in the dropdown, return 400 with helpful error listing available models.
5. **Process crash recovery:** If the browser page crashes or closes during long-running agent sessions, the worker must recreate the page automatically.

---

### Task 1: Project Scaffolding, Configuration, and Types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/types.ts`
- Create: `src/config.ts`
- Create: `vitest.config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `Config` object with `port`, `host`, `userDataDir`, `arenaBaseUrl`, `headless`.
- Produces: TypeScript types for OpenAI request/response (`ChatCompletionRequest`, `ChatCompletionChunk`, `ModelInfo`).

- [x] **Step 1: Write the failing test for configuration loader**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement `src/types.ts`, `src/config.ts`, `package.json`, `tsconfig.json`**
- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit scaffolding**

---

### Task 2: OpenAI API Schema and Serialization Engine

**Files:**
- Create: `src/server/openai-formatter.ts`
- Test: `tests/openai-formatter.test.ts`

**Interfaces:**
- Produces: `formatChatCompletionChunk(id: string, model: string, textDelta: string, finishReason?: string): string`
- Produces: `formatChatCompletionResponse(id: string, model: string, fullContent: string): ChatCompletionResponse`
- Produces: `formatModelList(models: string[]): ModelListResponse`

- [x] **Step 1: Write tests for chunk formatter, non-streaming formatter, and model list formatter**
- [x] **Step 2: Run tests to verify they fail**
- [x] **Step 3: Implement formatting functions in `src/server/openai-formatter.ts`**
- [x] **Step 4: Run tests to verify they pass**
- [x] **Step 5: Commit**

---

### Task 3: Fastify Server with OpenAI Routes (`/v1/models` & `/v1/chat/completions`)

**Files:**
- Create: `src/server/app.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: `openai-formatter.ts`, `Config`
- Produces: `createServer(driver: ArenaDriver, config: Config): FastifyInstance`

- [x] **Step 1: Write server tests using a mock ArenaDriver (health, /v1/models, /v1/chat/completions with stream=false and stream=true)**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement Fastify routes in `src/server/app.ts`**
- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit**

---

### Task 4: Browser Session Manager and Profile Controller

**Files:**
- Create: `src/browser/manager.ts`
- Test: `tests/browser-manager.test.ts`

**Interfaces:**
- Produces: `BrowserManager` class with `launchLogin(): Promise<void>`, `getOrCreatePage(): Promise<Page>`, `close(): Promise<void>`.

- [ ] **Step 1: Write test for browser manager options and profile directory setup**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `BrowserManager` with Playwright persistent context and Chrome channel**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 5: Arena Web Automation Driver (`ArenaDriver`)

**Files:**
- Create: `src/arena/driver.ts`
- Create: `src/arena/selectors.ts`
- Create: `src/arena/models.ts`
- Test: `tests/arena-driver.test.ts`

**Interfaces:**
- Produces: `ArenaDriver` class with:
  - `listModels(): Promise<string[]>`
  - `sendMessage(model: string, messages: Message[], onChunk: (chunk: string) => void, signal?: AbortSignal): Promise<string>`

- [ ] **Step 1: Write unit tests for message normalization and model aliases**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `ArenaDriver` interacting with Arena Direct Chat (page automation + DOM stream observer)**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 6: CLI Interface and Operational Scripts

**Files:**
- Create: `src/cli.ts`
- Create: `scripts/login-arena-web.sh`
- Create: `scripts/run-arena-web.sh`
- Create: `README.md`
- Test: `tests/cli.test.ts`

**Interfaces:**
- CLI commands: `webbridge login`, `webbridge serve --port 8989`, `webbridge models`, `webbridge status`
- Scripts compatible with `Universal AI Gateway` conventions.

- [ ] **Step 1: Write CLI argument parsing tests**
- [ ] **Step 2: Implement `src/cli.ts` and bash helper scripts**
- [ ] **Step 3: Test CLI invocations**
- [ ] **Step 4: Commit**

---

### Task 7: End-to-End Verification and Gateway Integration

- [ ] **Step 1: Run comprehensive test suite**
- [ ] **Step 2: Verify binary and scripts execution**
- [ ] **Step 3: Document integration with Emo-AI-Gateway / New API**
