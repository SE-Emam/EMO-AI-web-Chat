# EMO-AI-web

A high-performance local web-to-API gateway, agent bridge, and Model Context Protocol (MCP) tunnel server.

EMO-AI-web connects web AI interfaces (Claude, Gemini, Qwen, Tencent AI Studio, Z.AI / GLM, and Arena) into standard local OpenAI-compatible endpoints (`/v1/chat/completions` with streaming SSE and `/v1/models`), accompanied by a local browser management UI.

---

## Features

- **OpenAI-Compatible API**: Implements `/v1/chat/completions` (streaming SSE and non-streaming) and `/v1/models`.
- **Integrated MCP Tunnel Server**: Built-in reverse tunnel manager to expose the local MCP endpoint (`/mcp`) to ChatGPT and OpenAI Platform Organization Tunnels, Cloudflare Quick Tunnels, or Ngrok.
- **Provider Session Router**: Enforces a strict single active session per provider to prevent duplicate browser tabs, with automatic rotation when turn thresholds are reached.
- **Agent Tool Bridge**: Native function calling (`tools`) support for web models, returning standard OpenAI `tool_calls` to Cursor, Cline, Roo-Code, and Copilot.
- **Local Management UI**: Visual dashboard at `http://127.0.0.1:8989` to manage providers, toggle models, inspect sessions, and monitor usage.
- **Persistent Browser Profiles**: Stores authentication tokens and cookies locally in `~/.arena-webbridge/` so logins persist across sessions.
- **Multi-Agent Swarm Coordinator**: Decomposes high-level coding goals into specialized subagent workflows.

---

## Requirements

- **Node.js**: v20.0.0 or later
- **Google Chrome** or Playwright Chromium installed locally

---

## Installation

```bash
# Clone the repository
git clone https://github.com/SE-Emam/EMO-AI-web-Chat.git
cd EMO-AI-web-Chat

# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build
```

---

## Quick Start

### 1. Start the Gateway & Management UI

```bash
npm run emo
```

This launches the server on `http://127.0.0.1:8989` and opens the management dashboard in your default browser.

To start without opening the browser automatically:

```bash
npm start
```

### 2. Authenticate Providers (Login)

Before sending requests to a web provider, authenticate its browser profile once:

- **Via Management UI**: Navigate to `http://127.0.0.1:8989`, find the provider card (Claude, Gemini, Qwen, Arena, etc.), and click **Login**. A browser window opens for you to complete sign-in.
- **Via CLI**:
  ```bash
  npm run login
  ```
  Or specify a custom provider URL:
  ```bash
  npx webbridge login --url https://arena.ai
  ```

Cookies and session tokens are saved to `~/.arena-webbridge/` and reused automatically.

Verify your profile status at any time:

```bash
npx webbridge status
```

---

## Connecting AI Coding Agents

EMO-AI-web acts as a drop-in OpenAI-compatible backend for tools like Cursor, Cline, Roo-Code, and Copilot.

### Cursor / Cline / Roo-Code Configuration

- **API Base URL**: `http://127.0.0.1:8989/v1`
- **API Key**: `sk-local` (or any non-empty string)
- **Model**: Select any available model (e.g. `claude-3-7-sonnet`, `gpt-4o`, `deepseek-r1`, `gemini-2.0-flash`, `qwen-2.5-max`)

### cURL Example

```bash
curl -X POST http://127.0.0.1:8989/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-7-sonnet",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Explain binary search trees concisely."}
    ]
  }'
```

---

## MCP Tunnel Server (Connecting ChatGPT to Local Machine)

EMO-AI-web includes an embedded MCP reverse tunnel manager that connects local machine tools and files to ChatGPT.

### Supported Tunnel Providers

1. **OpenAI Organization Tunnels**:
   - Configurable at [OpenAI Platform Tunnels](https://platform.openai.com/settings/organization/tunnels).
   - Uses a native in-memory long-poll worker inside the gateway (no external binaries or downloads required).
   - Enter your `Tunnel ID` and `API Key` in the Management UI under MCP settings, or via API:
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
   - Zero-config HTTPS tunnel (`*.trycloudflare.com`).
   - Requires no API key or account registration.
   - Start directly from the UI or via API:
     ```bash
     curl -X POST http://127.0.0.1:8989/api/tunnel/start \
       -H "Content-Type: application/json" \
       -d '{"provider": "cloudflared"}'
     ```

3. **Ngrok Tunnel**:
   - Supports custom ngrok authentication tokens and domains.

---

## Provider Session Router

To prevent excessive tab creation and token exhaustion during continuous conversations:

- **Single Active Session**: Routes sequential requests for a provider through a single active browser conversation tab.
- **Turn Rotation**: Automatically rotates to a fresh conversation when the turn threshold (default: 20 turns) is reached.
- **Clean Teardown**: Closes previous tabs safely without leaving orphaned browser processes.

---

## Multi-Agent Swarm Coordinator

Execute complex development goals with coordinated specialized subagents:

```bash
# Run swarm via CLI
npm run swarm "Design and implement rate-limiting middleware"

# Or with specific mode (auto, pipeline, parallel)
npx webbridge swarm "Audit system performance" --mode parallel
```

---

## Configuration Reference

Settings can be customized via `.env` or environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` / `ARENA_PORT` | `8989` | HTTP server listening port |
| `HOST` | `127.0.0.1` | Network binding host |
| `USER_DATA_DIR` | `~/.arena-webbridge/chrome-profile` | Persistent browser profile path |
| `HEADLESS` | `true` | Run browser in headless mode |
| `CLAUDE_WEB_ENABLED` | `false` | Enable Claude web provider |
| `GEMINI_WEB_ENABLED` | `false` | Enable Gemini web provider |
| `QWEN_WEB_ENABLED` | `false` | Enable Qwen web provider |
| `ZAI_API_KEY` | _(empty)_ | Optional Z.AI direct API key |
| `ZAI_WEB_ENABLED` | `false` | Enable Z.AI web chat provider |
| `TENCENT_AI_WEB_ENABLED` | `false` | Enable Tencent AI Studio web provider |

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm run emo` | Start gateway and launch browser management UI |
| `npm start` | Start gateway in headless server mode |
| `npm run login` | Launch interactive browser to authenticate sessions |
| `npm run build` | Compile TypeScript into `dist/` |
| `npm run typecheck` | Run TypeScript type checks without emitting files |
| `npm run swarm [goal]` | Launch autonomous subagent swarm coordinator |
| `npx webbridge status` | Display profile and authentication status |
| `npx webbridge models` | List all discovered and supported models |

---

## License

MIT
