# EMO-AI-web

A high-performance local web-to-API gateway, multi-provider router, agent bridge, and Model Context Protocol (MCP) tunnel server.

EMO-AI-web converts web AI chat interfaces (ChatGPT, Claude, Gemini, DeepSeek, Qwen, Grok, Kimi, MiniMax, EMO.ai, and more) into standard local OpenAI-compatible endpoints (`/v1/chat/completions` with streaming SSE and `/v1/models`), backed by an intuitive browser management dashboard.

---

## Key Highlights

- **Standard OpenAI API Compatibility**: Drop-in replacement for OpenAI API (`/v1/chat/completions`, `/v1/models`) supporting streaming SSE and non-streaming modes.
- **15+ Supported Web Providers**: Seamless integration with premier web AI platforms without requiring paid API credits.
- **Multi-Account Management**: Add, manage, and isolate multiple accounts per provider with separate browser profiles.
- **Intelligent Router Groups**: Create virtual model clusters with automatic **Sequential Failover** or **Round-Robin Load Balancing** across models and accounts.
- **Autonomous Agent Swarm Coordinator**: Decomposes complex engineering goals across 4 specialized parallel subagents (`architect`, `coder`, `reviewer`, `tester`) with final deliverable synthesis.
- **Provider Session Router**: Enforces single active session per provider, eliminating tab duplication and rotating conversations cleanly upon reaching turn limits.
- **Agent Tool Bridge**: Native function calling (`tools`) support for web models, returning standard OpenAI `tool_calls` to Cursor, Cline, Roo-Code, and Copilot.
- **Embedded MCP Reverse Tunnel Server**: Exposes local machine tools and files to ChatGPT via OpenAI Organization Tunnels, Cloudflare Quick Tunnels, or Ngrok.
- **100% Local Privacy**: Runs entirely on `127.0.0.1` — your prompts, credentials, and cookies never leave your machine.

---

## Architecture: How It Works

```
┌────────────────────────────────────────────────────────┐
│  Clients: Cursor / Cline / Roo-Code / Copilot / Python │
└───────────────────────────┬────────────────────────────┘
                            │ Standard OpenAI Request (/v1)
                            ▼
┌────────────────────────────────────────────────────────┐
│                   EMO-AI-web Gateway                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │   Intelligent Router Groups (Failover / RR)      │  │
│  └────────────────────────┬─────────────────────────┘  │
│                           │                            │
│  ┌────────────────────────▼─────────────────────────┐  │
│  │     Provider Session Router & Multi-Account      │  │
│  │   - Single active session per provider           │  │
│  │   - Isolated profile directories per account     │  │
│  │   - Auto turn rotation & context compaction      │  │
│  └────────────────────────┬─────────────────────────┘  │
│                           │                            │
│  ┌────────────────────────▼─────────────────────────┐  │
│  │       Playwright Persistent Browser Context      │  │
│  │  - Headless execution with saved session cookies │  │
│  │  - Native Tool Calling Bridge & Token Extraction │  │
│  └────────────────────────┬─────────────────────────┘  │
│                           │                            │
│  ┌────────────────────────▼─────────────────────────┐  │
│  │       Embedded MCP Tunnel Manager (Port 8989)    │  │
│  │  - OpenAI Platform Org Tunnels (Native Poller)   │  │
│  │  - Cloudflare Quick Tunnel (Free HTTPS Endpoint) │  │
│  └──────────────────────────────────────────────────┘  │
└───────────────────────────┬────────────────────────────┘
                            │ Authenticated Web Automation
                            ▼
┌────────────────────────────────────────────────────────┐
│ Web Providers: ChatGPT / Claude / Gemini / DeepSeek... │
└────────────────────────────────────────────────────────┘
```

1. **Client Request**: Your coding assistant or client sends a standard `/v1/chat/completions` payload to `http://127.0.0.1:8989/v1`.
2. **Router Group & Model Resolution**: If a virtual group or model prefix is requested, the router chooses the target provider, model, and account based on the configured strategy (Sequential or Round-Robin).
3. **Session Routing**: The `ProviderSessionRouter` routes the prompt into the active conversation tab for that provider, preventing runaway tab spawns.
4. **Browser Automation**: Playwright drives the authenticated web session headlessly using cookies saved in `~/.arena-webbridge/`.
5. **Real-time SSE Streaming**: Tokens are scraped as they are generated and streamed back to the client via Server-Sent Events (`text/event-stream`).
6. **Agent Tool Bridge**: When tools are provided in the request, the bridge injects OpenAPI schema instructions and translates model JSON outputs into official OpenAI `tool_calls`.

---

## Supported Web Providers

EMO-AI-web supports 15 web AI platforms out of the box:

| Provider | Model Prefix(es) | Platform URL | Description & Default Models |
|---|---|---|---|
| **ChatGPT Web** | `chatgpt:*`, `chatgpt:`, `gpt:*` | `https://chatgpt.com` | Official ChatGPT web session (`gpt-4o`, `o1`, `o3-mini`) |
| **Claude Web** | `claude-web:*`, `claudeai:*` | `https://claude.ai` | Claude 3.7 Sonnet (Thinking mode), Claude 3.5 Sonnet |
| **Gemini Web** | `gemini-web:*`, `geminiweb:*` | `https://gemini.google.com` | Google Gemini 2.0 Flash, Gemini 1.5 Pro |
| **DeepSeek Web** | `deepseek-web:*`, `deepseek:*` | `https://chat.deepseek.com` | DeepSeek-R1 (Full Reasoning), DeepSeek-V3 |
| **Qwen Web** | `qwen-web:*`, `qwenweb:*` | `https://chat.qwen.ai` | Qwen 2.5 Max, Qwen 2.5 Coder 32B |
| **Grok Web** | `grok-web:*`, `grok:*` | `https://grok.com` | Grok 2, Grok 3 reasoning |
| **Kimi Web** | `kimi-web:*`, `moonshot:*` | `https://www.kimi.com` | Moonshot Kimi 1.5 long-context reasoning |
| **MiniMax Web** | `minimax-web:*`, `hailuo:*` | `https://agent.minimax.io` | MiniMax Hailuo AI agent web chat |
| **Z.AI Web / GLM**| `zai-web:*`, `glm-*` | `https://chat.z.ai` | Zhipu GLM-5, GLM-4.7, GLM-4.5 Flash |
| **EMO Web** | Default fallback | `https://emo.ai` | Direct multi-model evaluation and battle chat |
| **Tencent AI** | `tencent-ai:*`, `tencentai:*` | `https://aistudio.tencent.ai/` | Tencent Hunyuan and AI Studio web chat |
| **Mistral Web** | `mistral-web:*`, `lechat:*` | `https://chat.mistral.ai` | Mistral Large, Le Chat platform |
| **LongCat Web** | `longcat-web:*`, `longcat:*` | `https://longcat.ai/chat/` | LongCat AI aggregation chat |
| **LLM7 Web** | `llm7-web:*`, `llm7:*` | `https://llm7.chat` | Multi-LLM web platform |
| **LLM Kiwi Web** | `kiwi-web:*`, `kiwi:*` | `https://chat.llm.kiwi` | Kiwi AI chat interface |

*Note: You can also route to direct REST APIs (e.g., Z.AI REST API via `ZAI_API_KEY`) alongside web sessions.*

---

## Multi-Account Management

EMO-AI-web allows you to link multiple accounts to each web provider:

- **Isolated Browser Profiles**: Each added account receives its own dedicated profile directory (`~/.arena-webbridge/<provider>-profile-<accId>`), guaranteeing session isolation.
- **Active Account Selection**: Switch the active account with one click in the Web UI or via API.
- **Failover & Rotation**: If one account hits a daily usage limit or rate limit, the router automatically fails over to other authenticated accounts.
- **Quick Authentication**: Log into each account independently through the interactive headful browser launcher.

---

## Intelligent Router Groups

Router Groups allow you to define virtual composite models combining multiple providers, models, and accounts under a single name (e.g., `fast-code`, `heavy-reasoning`, `free-tier`):

### Routing Strategies

1. **Sequential Failover (`sequential`)**:
   - Tries targets in order of priority.
   - If Target 1 fails (rate limit, captcha, network error), the gateway immediately fails over to Target 2 without dropping the client connection.
2. **Round-Robin Load Balancing (`round-robin`)**:
   - Distributes requests evenly across targets.
   - Ideal for balancing load across multiple free accounts or distributing high-volume requests.

### Using Router Groups

Once created in the Management UI (`http://127.0.0.1:8989`), router groups behave like standard models:

```bash
# Call a custom router group named "heavy-reasoning"
curl -X POST http://127.0.0.1:8989/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "heavy-reasoning",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Analyze time complexity of distributed consensus."}
    ]
  }'
```

---

## Autonomous Agent Swarm Coordinator

EMO-AI-web includes an integrated multi-agent swarm engine that autonomously orchestrates complex software engineering tasks:

### Specialized Worker Roles

1. **Coordinator (`coordinator`)**: Analyzes the high-level goal, decomposes it into discrete technical slices, coordinates workers, and synthesizes final unified deliverables.
2. **Architect (`architect`)**: Designs system blueprints, data schemas, API contracts, and computational boundaries (routed to `deepseek-r1`, `o1`, or `claude-3-7-sonnet`).
3. **Coder (`coder`)**: Writes complete, production-grade, fully-typed code with clean error handling and zero omissions (routed to `claude-3-7-sonnet`, `gpt-4o`, or `qwen-2.5-max`).
4. **Reviewer (`reviewer`)**: Conducts rigorous security, race-condition, vulnerability, and performance audits.
5. **Tester (`tester`)**: Authors comprehensive unit, boundary, and integration test suites (routed to `gemini-2.0-flash` or `claude-3-5-haiku`).

### Execution Modes

- `auto`: Dynamic task decomposition, parallel execution, and automated synthesis (default).
- `pipeline`: Sequential stage-by-stage progression (`architect` → `coder` → `reviewer` → `tester`).
- `parallel`: All subagents explore the objective concurrently from their domain perspectives before final synthesis.

### Invoking Swarm

```bash
# 1. Via CLI
npm run swarm "Build a distributed rate-limiter with Redis"

# Or with specific mode
npx emo-ai-web swarm "Audit repository architecture" --mode parallel

# 2. Via OpenAI API (/v1/chat/completions)
curl -X POST http://127.0.0.1:8989/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "swarm:auto",
    "stream": true,
    "messages": [{"role": "user", "content": "Refactor authentication flow to JWT with refresh tokens"}]
  }'

# 3. Via Web UI: Open http://127.0.0.1:8989 and switch to the Swarm Dashboard tab.
```

---

## MCP Tunnel Server (Connecting ChatGPT to Local Machine)

Expose your local Model Context Protocol (MCP) server (`http://127.0.0.1:8989/mcp`) so ChatGPT can read, edit, and run local workspace files safely.

### Supported Tunnel Providers

1. **OpenAI Organization Tunnels**:
   - Native integration with [OpenAI Platform Tunnels](https://platform.openai.com/settings/organization/tunnels).
   - Driven by an **in-memory long-poll worker** (zero external binaries or downloads required).
   - Enter your `Tunnel ID` and `API Key` in the UI or start via API:
     ```bash
     curl -X POST http://127.0.0.1:8989/api/tunnel/start \
       -H "Content-Type: application/json" \
       -d '{
         "provider": "openai",
         "tunnelId": "YOUR_TUNNEL_ID",
         "apiKey": "YOUR_OPENAI_API_KEY"
       }'
     ```

2. **Cloudflare Quick Tunnel**:
   - Zero-configuration HTTPS tunnel (`*.trycloudflare.com`).
   - Requires no account or token — launches instantly with one click in the Web UI.

---

## Installation & Setup

### Prerequisites

- **Node.js**: v20.0.0 or later
- **Google Chrome** or Playwright Chromium installed locally

### Installation

```bash
# Clone the repository
git clone https://github.com/SE-Emam/EMO-AI-web-Chat.git
cd EMO-AI-web-Chat

# Install dependencies
npm install

# Build TypeScript
npm run build
```

---

## Quick Start

### 1. Launch Gateway & Dashboard

```bash
npm run emo
```

Starts the server on port `8989` and automatically opens the Management UI in your browser (`http://127.0.0.1:8989`).

To run headlessly in the background:

```bash
npm start
```

### 2. Authenticate Providers (One-Time Login)

- **Via Web UI (Recommended)**: On `http://127.0.0.1:8989`, click the **Login** button next to any provider. Solve any Cloudflare challenge or sign in once.
- **Via CLI**:
  ```bash
  npm run login
  # Or target a specific provider:
  npx emo-ai-web login --url https://claude.ai
  ```

Cookies and tokens are saved locally in `~/.arena-webbridge/` and reused automatically.

Verify your authentication status:

```bash
npx emo-ai-web status
```

---

## Connecting AI Coding Agents

EMO-AI-web works as a drop-in replacement for OpenAI API in your favorite coding tools:

### Configuration for Cursor / Cline / Roo-Code

- **API Base URL**: `http://127.0.0.1:8989/v1`
- **API Key**: `sk-local` (or any string)
- **Model**: Any supported prefix or router group (e.g. `claude-web:claude-3-7-sonnet`, `deepseek-web:deepseek-r1`, `chatgpt-web:gpt-4o`, `heavy-reasoning`)

### cURL Example

```bash
curl -X POST http://127.0.0.1:8989/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-web:deepseek-r1",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Explain raft consensus in simple terms."}
    ]
  }'
```

---

## Configuration Reference

Settings can be set via `.env` or environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` / `ARENA_PORT` | `8989` | HTTP API server port |
| `HOST` | `127.0.0.1` | Network binding interface |
| `USER_DATA_DIR` | `~/.arena-webbridge/chrome-profile` | Chrome user data directory |
| `HEADLESS` | `true` | Run browser automation headlessly |
| `CLAUDE_WEB_ENABLED` | `false` | Enable Claude web provider |
| `GEMINI_WEB_ENABLED` | `false` | Enable Gemini web provider |
| `QWEN_WEB_ENABLED` | `false` | Enable Qwen web provider |
| `ZAI_WEB_ENABLED` | `false` | Enable Z.AI web chat provider |
| `ZAI_API_KEY` | _(empty)_ | Optional direct Z.AI REST API key |
| `TENCENT_AI_WEB_ENABLED` | `false` | Enable Tencent AI Studio provider |

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `npm run emo` | Start gateway and launch browser management UI |
| `npm start` | Start gateway in background / headless mode |
| `npm run login` | Open interactive browser for session authentication |
| `npm run build` | Compile TypeScript into `dist/` |
| `npm run typecheck` | Run TypeScript type checks without emitting files |
| `npm run swarm [goal]` | Launch autonomous subagent swarm coordinator |
| `npx emo-ai-web status` | Display profile and authentication status |
| `npx emo-ai-web models` | List all discovered and supported models |

---

## License

MIT
