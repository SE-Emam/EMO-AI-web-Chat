# Arena WebBridge (`arena-web-api`)

> OpenAI-compatible local Web-to-API bridge for [Arena](https://arena.ai/) (LMSYS Chatbot Arena).

Arena WebBridge automates the direct chat interface on `https://arena.ai` using a persistent real Chrome browser profile. It seamlessly handles Cloudflare verification, saves your authenticated session, and exposes a high-performance, standard OpenAI API interface (`/v1/chat/completions` with streaming support and `/v1/models`) on port `8989`.

---

## Key Features

- **Standard OpenAI API Compatibility**: Implements `/v1/chat/completions` (streaming SSE and non-streaming) and `/v1/models`.
- **Direct Chat Automation**: Automates Arena's direct chat mode, selecting models and streaming tokens in real time.
- **Persistent Profile & Cloudflare Bypass**: Stores cookies, local storage, and session tokens in `~/.arena-webbridge/chrome-profile` to avoid repeated re-verifications.
- **Interactive Verification**: Single-command interactive browser launch (`login`) to solve Cloudflare Turnstile challenges or log in with Google/GitHub once.
- **Model Resolution & Aliasing**: Smart model mapping for major models (`claude-3-7-sonnet`, `claude-3-5-sonnet`, `deepseek-r1`, `gpt-4o`, `gemini-2.0-flash`, `qwen-2.5-max`, etc.).
- **Agent Ready**: Plug-and-play with OpenCode, Cline, Cursor, Roo-Code, Pi, and multi-provider aggregators like Emo-AI-Gateway, New API, and One API.

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

### Command Options

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

---

## Supported Models

Arena WebBridge automatically resolves common model names and aliases to the corresponding model in Arena's Direct Chat:

| Canonical ID | Common Aliases / Inputs |
|--------------|-------------------------|
| `claude-3-7-sonnet` | `claude-3.7-sonnet`, `claude-3-7-sonnet-latest` |
| `claude-3-5-sonnet` | `claude-3.5-sonnet`, `claude`, `auto`, `default` |
| `claude-3-opus` | `claude-3-opus-latest` |
| `claude-3-haiku` | `claude-haiku` |
| `deepseek-r1` | `deepseek-reasoner`, `deepseek`, `r1` |
| `deepseek-v3` | `deepseek-chat`, `v3` |
| `gpt-4o` | `gpt-4`, `chatgpt-4o`, `gpt-4-turbo` |
| `gpt-4o-mini` | `gpt-4o-mini-2024-07-18` |
| `o1` | `o1-preview`, `openai/o1` |
| `o1-mini` | `o1-mini-2024-09-12` |
| `o3-mini` | `o3-mini-latest` |
| `gemini-2.0-flash` | `gemini-flash`, `gemini` |
| `gemini-1.5-pro` | `gemini-pro` |
| `gemini-1.5-flash` | `gemini-1.5-flash-latest` |
| `qwen-2.5-max` | `qwen`, `qwen-max` |
| `qwen-2.5-72b-instruct` | `qwen-72b` |
| `llama-3.3-70b-instruct` | `llama-3.3-70b` |
| `llama-3.1-405b-instruct` | `llama-3.1-405b` |
| `mistral-large-2411` | `mistral-large` |

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

## License

MIT
