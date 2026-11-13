# EMO-AI-web (`emo-ai-web`)

> OpenAI-compatible local web-to-API gateway and agent bridge (formerly Arena WebBridge).

EMO-AI-web automates web AI chat interfaces using persistent browser profiles, manages providers/accounts, and exposes a high-performance OpenAI-compatible API interface (`/v1/chat/completions` with streaming support and `/v1/models`) on port `8989`, plus a local management UI.

---

## Key Features

- **Standard OpenAI API Compatibility**: Implements `/v1/chat/completions` (streaming SSE and non-streaming) and `/v1/models`.
- **Autonomous Swarm Coordinator (موجه الوكلاء)**: Automated decomposition of high-level coding goals into 4 parallel specialized subagents (`architect`, `coder`, `reviewer`, `tester`), with unified deliverable synthesis.
- **Native Tool & Function Calling (`tools`)**: Injects and interprets OpenAPI tool schemas for web-based models, returning standard OpenAI `tool_calls` to Cursor, Cline, and Roo-Code.
- **Tab Worker Pool & Concurrency**: Manages multiple concurrent browser tabs per profile to process parallel requests without serialization bottlenecks.
- **Local Secret Redaction**: Auto-masks API keys, secrets, tokens, and credentials from outgoing prompts, restoring them transparently upon return.
- **Auto-Compaction & Session Reset**: Automatically compacts context and resets sessions when turn limits are approached to prevent token bloat and page crashes.
- **Direct Chat Automation**: Automates Arena's direct chat mode, selecting models and streaming tokens in real time.
- **Persistent Profile & Cloudflare Bypass**: Stores cookies, local storage, and session tokens in `~/.arena-webbridge/chrome-profile` to avoid repeated re-verifications.
- **Interactive Verification**: Single-command interactive browser launch (`login`) to solve Cloudflare Turnstile challenges or log in with Google/GitHub once.
- **Model Resolution & Aliasing**: Smart model mapping for major models (`claude-3-7-sonnet`, `claude-3-5-sonnet`, `deepseek-r1`, `gpt-4o`, `gemini-2.0-flash`, `qwen-2.5-max`, etc.).
- **Agent Ready**: Plug-and-play with OpenCode, Cline, Cursor, Roo-Code, Pi, and multi-provider aggregators like Emo-AI-Gateway, New API, and One API.
- **Interactive Swarm Dashboard**: Dedicated visual tab in EMO-AI Gateway UI (`http://127.0.0.1:8989/`) to launch and monitor swarms.

---

## Installation & Setup

### Prerequisites

- **Node.js**: v18.0.0 or later (v20+ recommended)
- **Google Chrome** (or Playwright Chromium) installed locally

```bash
# Clone and enter project directory
cd /path/to/arena-web-bridge

# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build
```

---

## Quickstart

### Step 1: Login & Verify Session

Before starting the server for the first time, open the interactive browser window to navigate to Arena and complete any Cloudflare challenge or login:

```bash
# Using npm
npm run login

# Or using the helper script
./scripts/login-arena-web.sh

# Or using the CLI binary
npx webbridge login
```

1. A visible Chrome window opens to `https://arena.ai/?arena=direct`.
2. Solve any Cloudflare challenge or log in with your credentials.
3. Close the browser window (or press `Ctrl+C` in your terminal). Your session and cookies are now saved to disk.

Verify that your profile contains active session data:

```bash
npx webbridge status
```

Output:
```
=== Arena WebBridge Profile Status ===
Profile Directory: /Users/username/.arena-webbridge/chrome-profile
Directory Exists:  Yes
Session Data:      Found (authenticated / active session)
```

---

### Step 2: Start the WebBridge API

Start the local OpenAI-compatible API server:

```bash
# Using npm
npm start

# Or using the runner script
./scripts/run-arena-web.sh

# Or using the CLI binary
npx webbridge serve --port 8989
```

When started, you will see:
```
Arena WebBridge listening at http://127.0.0.1:8989/v1
```

---

## CLI Usage

The package exports both `arena-web-api` and `webbridge` commands:

```bash
webbridge --help
```

### Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| `login` | Opens interactive browser to complete login and Cloudflare verification | `webbridge login` |
| `serve` | Runs the API server (default command) | `webbridge serve --port 8989` |
| `models`| Lists supported models in tabular or JSON format | `webbridge models --json` |
| `status`| Checks if persistent profile and session cookies exist | `webbridge status` |
| `swarm` | Launches the autonomous multi-agent swarm coordinator | `webbridge swarm "Build auth system"` |

### Command Options

#### `webbridge swarm [goal]`
- `[goal]`: The coding task or goal to execute with the specialized subagent swarm.
- `-m, --mode <mode>`: Execution mode: `auto` (default), `pipeline`, `parallel`.

---

## 🚀 Autonomous Swarm Coordinator & Multi-Agent Engine

Arena WebBridge includes an autonomous **Swarm Coordinator (موجه الوكلاء)** that automatically decomposes complex software engineering goals into discrete tasks handled by 4 specialized subagents in parallel:

1. **Architect (`architect`)**: Analyzes requirements, models schemas, designs algorithms, and establishes system boundaries (routed to `deepseek-r1` / `o1` / `o3-mini`).
2. **Coder (`coder`)**: Implements clean, complete, production-grade code with full types and error handling (routed to `claude-3-7-sonnet` / `gpt-4o` / `qwen-2.5-max`).
3. **Reviewer (`reviewer`)**: Audits security vulnerabilities, race conditions, edge-case bugs, and performance regressions.
4. **Tester (`tester`)**: Authors comprehensive unit, integration, and property test suites (routed to `gemini-2.0-flash` / `haiku`).

### Using Swarm via CLI
```bash
# Run swarm with default auto mode
npm run swarm "Build a rate limiter with Redis and vitest tests"

# Or using the webbridge binary
npx webbridge swarm "Audit repository security" --mode parallel
```

### Using Swarm via OpenAI API (`/v1/chat/completions`)
Any OpenAI client (Cursor, Cline, Roo-Code, Python, cURL) can trigger the Swarm by specifying any `swarm:*` model:
- `swarm:auto`
- `swarm:fullstack`
- `swarm:pipeline`
- `swarm:parallel`

```bash
curl -X POST http://127.0.0.1:8989/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "swarm:auto",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Design and implement a resilient caching layer"}
    ]
  }'
```

### Dedicated Swarm API
- `POST /v1/agents/swarm`: Submit structured swarm goals and stream live events.
- `GET /v1/agents/swarm/status`: Inspect coordinator status, worker roles, and active sessions.
- `GET /v1/agents/swarm/sessions`: Retrieve recent swarm execution deliverables and history.

> For complete architectural specifications and deep documentation, see [docs/swarm-and-agentic-features.md](docs/swarm-and-agentic-features.md).

#### `webbridge login`
- `--url <url>`: Arena URL to navigate to (default: `https://arena.ai`)
- `--user-data-dir <dir>`: Custom Chrome user data directory

#### `webbridge serve` (default)
- `-p, --port <port>`: Port to listen on (default: `8989` or `ARENA_PORT` / `PORT` env)
- `-h, --host <host>`: Host to bind (default: `127.0.0.1` or `HOST` env)
- `--user-data-dir <dir>`: Custom Chrome profile directory (default: `~/.arena-webbridge/chrome-profile`)
- `--headless <boolean>`: Run headless (`true`/`false`, default: `true`)

#### `webbridge models`
- `--json`: Output model list as JSON array

#### `webbridge status`
- `--user-data-dir <dir>`: Path to profile directory to inspect
- `--json`: Output status report as JSON

---

## Configuration & Environment Variables

You can configure Arena WebBridge via CLI flags or environment variables:

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `ARENA_PORT` / `PORT` | `8989` | Port for the HTTP API server |
| `HOST` | `127.0.0.1` | Host address to bind |
| `USER_DATA_DIR` | `~/.arena-webbridge/chrome-profile` | Persistent Chrome profile directory |
| `ARENA_BASE_URL` | `https://arena.ai` | Base URL of Arena |
| `HEADLESS` | `true` | Whether to run browser headlessly |
| `ZAI_API_KEY` | _(empty)_ | **Optional**: enables the Z.AI (Zhipu) provider. When set, `glm-*` model IDs are served directly from Z.AI over plain HTTP (no browser, no Arena rate limits) |
| `ZAI_BASE_URL` | `https://api.z.ai/api/paas/v4/` | Z.AI API base URL |
| `ZAI_DEFAULT_MODEL` | `glm-5.3-flash` | Default model when a GLM id is unrecognized (`glm-4.7-flash` / `glm-4.5-flash` are completely free) |
| `ZAI_WEB_ENABLED` | `false` | Enable Z.AI web-session (chat.z.ai) fallback for `glm-*` |
| `ZAI_WEB_BASE_URL` | `https://chat.z.ai` | Z.AI web base URL |
| `ZAI_WEB_USER_DATA_DIR` | `~/.arena-webbridge/zai-profile` | Persistent profile for the Z.AI web session |
| `ZAI_WEB_HEADLESS` | `false` | Run Z.AI web browser headlessly |
| `ZAI_WEB_TIMEOUT_MS` | `180000` | Z.AI web request timeout (ms) |
| `ZAI_WEB_CAPTCHA_WAIT_MS` | `180000` | Z.AI web captcha wait (ms) |
| `CLAUDE_WEB_ENABLED` | `false` | Enable Claude (claude.ai) web-session provider |
| `CLAUDE_WEB_BASE_URL` | `https://claude.ai` | Claude web base URL |
| `CLAUDE_WEB_USER_DATA_DIR` | `~/.arena-webbridge/claude-profile` | Persistent profile for the Claude web session |
| `CLAUDE_WEB_HEADLESS` | `false` | Run Claude web browser headlessly |
| `CLAUDE_WEB_TIMEOUT_MS` | `300000` | Claude web request timeout (ms) |
| `TENCENT_AI_WEB_ENABLED` | `false` | Enable Tencent AI Studio (aistudio.tencent.ai) web provider |
| `TENCENT_AI_WEB_BASE_URL` | `https://aistudio.tencent.ai` | Tencent AI Studio base URL |
| `TENCENT_AI_WEB_USER_DATA_DIR` | `~/.arena-webbridge/tencent-ai-profile` | Persistent profile for the Tencent AI Studio session |
| `TENCENT_AI_WEB_HEADLESS` | `false` | Run Tencent AI Studio web browser headlessly |
| `TENCENT_AI_WEB_TIMEOUT_MS` | `300000` | Tencent AI Studio request timeout (ms) |
| `GEMINI_WEB_ENABLED` | `false` | Enable Gemini (gemini.google.com) web provider |
| `GEMINI_WEB_BASE_URL` | `https://gemini.google.com` | Gemini web base URL |
| `GEMINI_WEB_USER_DATA_DIR` | `~/.arena-webbridge/gemini-profile` | Persistent profile for the Gemini web session |
| `GEMINI_WEB_HEADLESS` | `false` | Run Gemini web browser headlessly |
| `GEMINI_WEB_TIMEOUT_MS` | `300000` | Gemini web request timeout (ms) |
| `QWEN_WEB_ENABLED` | `false` | Enable Qwen (chat.qwen.ai) web provider |
| `QWEN_WEB_BASE_URL` | `https://chat.qwen.ai` | Qwen web base URL |
| `QWEN_WEB_USER_DATA_DIR` | `~/.arena-webbridge/qwen-profile` | Persistent profile for the Qwen web session |
| `QWEN_WEB_HEADLESS` | `false` | Run Qwen web browser headlessly |
| `QWEN_WEB_TIMEOUT_MS` | `300000` | Qwen web request timeout (ms) |

### Providers & Routing (model prefixes)

At startup (`serve`) the bridge builds a routing chain — first match wins. Providers are enabled via env flags above (or the `gateway.json` UI, see `docs/gateway-integration.md`):

| Provider | Model prefix(es) | Backend / base URL | Enablement |
|----------|------------------|--------------------|------------|
| **Arena Browser** (default fallback) | _anything else_ (plain IDs like `claude-3-7-sonnet`, `gpt-4o`, `auto`) | Browser automation of `https://arena.ai` | Always available |
| **Z.AI REST API** | `glm-*` (via `ZAI_DEFAULT_MODEL_PREFIXES = ['glm-']`) | Direct fetch to `https://api.z.ai/api/paas/v4/` (no browser) | Set `ZAI_API_KEY` |
| **Z.AI Web** | `glm-*` / `zai-web:*` | Browser session at `https://chat.z.ai` | `ZAI_WEB_ENABLED=1` |
| **Claude Web** | `claude-web:*`, `claudeai:*` | Browser session at `https://claude.ai` | `CLAUDE_WEB_ENABLED=1` |
| **Tencent AI Studio Web** | `tencent-ai:*`, `tencentai:*` | Browser session at `https://aistudio.tencent.ai` | `TENCENT_AI_WEB_ENABLED=1` |
| **Gemini Web** | `gemini-web:*`, `geminiweb:*` | Browser session at `https://gemini.google.com` | `GEMINI_WEB_ENABLED=1` |
| **Qwen Web** | `qwen-web:*`, `qwenweb:*` | Browser session at `https://chat.qwen.ai` | `QWEN_WEB_ENABLED=1` |

Ordering notes: the explicit `claude-web:` / `tencent-ai:` / `gemini-web:` / `qwen-web:` prefixes avoid colliding with Arena's `claude-*` / `gemini-*` / `qwen-*` names. For `glm-*`, the Z.AI REST API runs first, then the Z.AI web session, then the Arena browser.

### Z.AI Provider (dual backend)

Arena's own quota is limited and can produce `403 recaptcha` / `429 rate limit` errors on free accounts. When `ZAI_API_KEY` is present, the bridge automatically becomes a **routing proxy**:

| Requested model | Served by | Notes |
|-----------------|-----------|-------|
| `glm-5.3-flash`, `glm-5.3-flashx`, `glm-5.3`, `glm-5.2`, `glm-5.1`, `glm-5`, `glm-4.7`, `glm-4.6`, `glm-4.7-flash`, `glm-4.5-flash` | **Z.AI API** (direct fetch, SSE) | `glm-4.7-flash` and `glm-4.5-flash` are **$0** |
| Everything else (`claude-*`, `gpt-*`, `auto`, …) | **Arena browser** | as before |

Get a Z.AI key at [z.ai/manage-apikey/apikey-list](https://z.ai/manage-apikey/apikey-list), then:

```bash
export ZAI_API_KEY="your-zai-key"
./scripts/run-arena-web.sh

# GLM models now bypass the Arena browser entirely:
curl -s http://127.0.0.1:8989/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"ping"}]}'
```

---

## Supported Models

Arena WebBridge automatically resolves common model names and aliases to the corresponding model in Arena's Direct Chat:

The alias table below mirrors `MODEL_ALIASES` in `src/arena/models.ts` exactly. Arena canonical IDs (`KNOWN_ARENA_MODELS`) are:

`claude-3-5-sonnet`, `claude-3-7-sonnet`, `claude-3-opus`, `claude-3-haiku`, `gpt-4o`, `gpt-4o-mini`, `o1`, `o1-mini`, `o3-mini`, `deepseek-r1`, `deepseek-v3`, `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`, `qwen-2.5-max`, `qwen-2.5-72b-instruct`, `llama-3.3-70b-instruct`, `llama-3.1-405b-instruct`, `mistral-large-2411`.

| Canonical ID | Explicit `MODEL_ALIASES` (source: `src/arena/models.ts`) |
|--------------|-------------------------|
| `claude-3-5-sonnet` (default / `DEFAULT_MODEL`) | `auto`, `default`, `claude`, `claude-3.5-sonnet`, `claude-3-5-sonnet-latest`, `claude-3-sonnet` |
| `claude-3-7-sonnet` | `claude-3.7-sonnet`, `claude-3-7-sonnet-latest` |
| `claude-3-opus` | `claude-3-opus-latest` |
| `gpt-4o` | `gpt-4`, `gpt-4-turbo`, `chatgpt-4o`, `chatgpt-4o-latest` |
| `deepseek-r1` | `deepseek`, `deepseek-reasoner` |
| `deepseek-v3` | `deepseek-chat` |
| `gemini-2.0-flash` | `gemini`, `gemini-flash` |
| `gemini-1.5-pro` | `gemini-pro` |
| `qwen-2.5-max` | `qwen` |
| `o1` | `o1-preview` |
| `claude-3-haiku`, `gpt-4o-mini`, `o1-mini`, `o3-mini`, `gemini-1.5-flash`, `qwen-2.5-72b-instruct`, `llama-3.3-70b-instruct`, `llama-3.1-405b-instruct`, `mistral-large-2411` | _(none — use the canonical ID exactly)_ |

Beyond explicit aliases, the resolver also normalizes inputs: it lowercases/trims, strips a provider prefix (`openai/gpt-4o` → `gpt-4o`), strips trailing date snapshots (`...-20241022`), normalizes dots (`claude-3.5-sonnet` → `claude-3-5-sonnet`), and falls back to a suffix/partial match (e.g. `r1` → `deepseek-r1`). Arena mode prefixes (`arena/direct/<model>`, `direct:`, `agent:`, `side-by-side:`) are parsed separately (see `parseArenaTarget`).

#### Z.AI (GLM) models

Served by the Z.AI providers (source: `ZAI_MODELS` in `src/arena/zai-models.ts`):

`glm-5.3-flash`, `glm-5.3-flashx`, `glm-5.3`, `glm-5.2`, `glm-5.1`, `glm-5`, `glm-4.7`, `glm-4.6`, `glm-4.7-flash`, `glm-4.5-flash`.

Z.AI aliases (`normalizeZaiModel`): `glm`, `zai` → `glm-5.3-flash`. Date snapshots are stripped the same way, and bare partials (e.g. `5.3-flash` → `glm-5.3-flash`) resolve. The two `$0` models are `glm-4.7-flash` and `glm-4.5-flash` (`ZAI_FREE_MODELS`).

Web providers expose per-provider pseudo-models that keep the session's current model: `claude-web:default`, `tencent-ai:default`, `gemini-web:default`, `qwen-web:default`.

To list all models programmatically:
```bash
curl http://127.0.0.1:8989/v1/models
```

---

## API Examples

### 1. Streaming Chat Completion (cURL)

```bash
curl -N http://127.0.0.1:8989/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer any-key" \
  -d '{
    "model": "claude-3-7-sonnet",
    "messages": [
      {"role": "user", "content": "Explain quantum computing in one short paragraph."}
    ],
    "stream": true
  }'
```

### 2. Non-Streaming Chat Completion (Python OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8989/v1",
    api_key="sk-not-required",
)

response = client.chat.completions.create(
    model="deepseek-r1",
    messages=[
        {"role": "system", "content": "You are a concise engineering assistant."},
        {"role": "user", "content": "Write a bash one-liner to find the 5 largest files in a directory."}
    ],
)

print(response.choices[0].message.content)
```

### 3. Node.js OpenAI SDK

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://127.0.0.1:8989/v1',
  apiKey: 'dummy-token',
});

const stream = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Say hello!' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

---

## Gateway & Agent Integrations

### Integration with Emo-AI-Gateway / New API / One API

Arena WebBridge acts as a local upstream provider for multi-tenant AI gateways. See [docs/gateway-integration.md](docs/gateway-integration.md) for complete details on Docker host networking, failover strategies, and advanced gateway routing.

1. **Open New API / One API / Emo-AI-Gateway Admin Dashboard**.
2. **Add a New Channel**:
   - **Type**: `OpenAI`
   - **Name**: `Arena WebBridge`
   - **Base URL**: `http://127.0.0.1:8989` (or `http://host.docker.internal:8989` if gateway runs in Docker)
   - **Key**: Any string (e.g. `sk-arena-local`)
   - **Models**: Select or input desired models (`claude-3-7-sonnet`, `claude-3-5-sonnet`, `deepseek-r1`, `gpt-4o`, `gemini-2.0-flash`, or `*`)
3. **Save and Test**: Click "Test" in the channel list to verify connection and model querying.

### Integration with OpenCode / Cline / Cursor

Configure your coding agent's OpenAI-compatible provider:

- **Base URL**: `http://127.0.0.1:8989/v1`
- **API Key**: `sk-dummy`
- **Model ID**: `claude-3-7-sonnet` (or any model from `npx webbridge models`)

---

## Operational Scripts

Two production-ready helper scripts are provided in `scripts/`:

- `scripts/login-arena-web.sh`:
  Launches interactive Chrome to refresh or log into Arena. Automatically falls back between built distribution (`dist/cli.js`) and `tsx` source development mode.
- `scripts/run-arena-web.sh`:
  Starts the API server with port configuration respecting `ARENA_PORT` and `PORT` environment variables (defaults to `8989`).

```bash
# Make executable (if needed)
chmod +x scripts/*.sh

# Run server on port 9000
ARENA_PORT=9000 ./scripts/run-arena-web.sh
```

---

## Testing & Quality Assurance

Arena WebBridge is developed with test-driven development (TDD). Run the Vitest test suite:

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch
```

---

## EMO.ai Local Gateway UI

Local browser UI for managing web providers (no admin/users), with OpenAI-compatible `/v1` endpoints.

```bash
# from project
./scripts/EMO.ai
# or after build/link
EMO.ai
# or dev
npm run emo
```

Outputs:
- `base uri: emo-web.ai/v1`
- `api: emo.web`

The UI opens in your browser for provider settings, model selection, runtime/start-stop, and session usage (heartbeat resets when the browser UI closes). To use `emo-web.ai` locally, add an optional hosts mapping: `127.0.0.1 emo-web.ai`.

---

## License

MIT
