# Gateway Integration Guide: Emo-AI-Gateway & New API / One API

This guide provides step-by-step instructions for integrating **Arena WebBridge** (`arena-web-api`) with multi-provider AI gateways, specifically **Emo-AI-Gateway**, **New API**, and **One API**.

---

## 1. Architecture Overview

```
                                      ┌─────────────────────────────────────────┐
                                      │              Local Machine              │
                                      │                                         │
┌───────────────────┐    OpenAI API   │  ┌────────────────┐    Browser Auto     │    HTTPS/WSS   ┌──────────────┐
│  Client / Agent   │ ──────────────> │  │ Emo-AI-Gateway │ ──────────────────> │ ─────────────> │   arena.ai   │
│ (Cursor, Cline,   │                 │  │   or New API   │                     │                │ (Direct Chat)│
│  OpenCode, cURL)  │                 │  └───────┬────────┘                     │                └──────────────┘
└───────────────────┘                 │          │ OpenAI HTTP                  │
                                      │          ▼                              │
                                      │  ┌────────────────┐                     │
                                      │  │ Arena WebBridge│                     │
                                      │  │ (Port 8989)    │                     │
                                      │  └────────────────┘                     │
                                      └─────────────────────────────────────────┘
```

Arena WebBridge exposes an OpenAI-compliant HTTP API (`/v1/chat/completions`, `/v1/models`, `/health`). Multi-tenant gateways can route requests for leading frontier models (Claude 3.7 Sonnet, DeepSeek R1, GPT-4o, Gemini 2.0 Flash) through Arena WebBridge without requiring paid API keys. Beyond Arena-browser models, it also serves Z.AI GLM models (`glm-*`) via the Z.AI REST API or web session when configured, plus prefixed web-session models (`claude-web:`, `tencent-ai:`, `gemini-web:`, `qwen-web:`) — see §4.2.

---

## 2. Prerequisites & Pre-flight

1. **Verify Arena WebBridge is running**:
   ```bash
   # Run the server
   ./scripts/run-arena-web.sh
   # Or: npx webbridge serve --port 8989
   ```

2. **Verify the health check**:
   ```bash
   curl http://127.0.0.1:8989/health
   # Expected output: {"status":"ok","service":"arena-web-api"}
   ```

3. **Verify the models list**:
   ```bash
   curl http://127.0.0.1:8989/v1/models
   # Returns list of available models in standard OpenAI format
   ```

---

## 3. Configuration in New API / One API

### Step 3.1: Access Channel Settings
1. Log in to your **New API** or **One API** administrator dashboard.
2. Navigate to **Channels** (`/channel`) and click **Add Channel** (添加渠道).

### Step 3.2: Configure Channel Parameters
Fill in the channel settings as follows:

| Field | Value | Notes |
|-------|-------|-------|
| **Type** (类型) | `OpenAI` | Arena WebBridge strictly implements the OpenAI REST protocol |
| **Name** (名称) | `Arena WebBridge` | Descriptive label |
| **Base URL** (代理地址) | `http://127.0.0.1:8989` | Use `http://host.docker.internal:8989` if New API runs in Docker |
| **Key** (密钥) | `sk-arena-local` | Any non-empty string (WebBridge does not enforce API keys locally) |
| **Models** (模型) | Select or type model IDs | Recommended models listed below |
| **Model Mapping** (模型重定向) | *(Optional)* | Map custom IDs if needed (e.g. `{"claude-3-7-sonnet-thinking": "claude-3-7-sonnet"}`) |
| **Group** (分组) | `default` (or custom group) | Assign to the desired user tiers |

### Supported Model Identifiers for Gateway Configuration:
Arena-browser canonical IDs (`KNOWN_ARENA_MODELS`, 19) — pass these verbatim, or any explicit `MODEL_ALIASES` alias (see README § Supported Models):

```
claude-3-7-sonnet
claude-3-5-sonnet
claude-3-opus
claude-3-haiku
deepseek-r1
deepseek-v3
gpt-4o
gpt-4o-mini
o1
o1-mini
o3-mini
gemini-2.0-flash
gemini-1.5-pro
gemini-1.5-flash
qwen-2.5-max
qwen-2.5-72b-instruct
llama-3.3-70b-instruct
llama-3.1-405b-instruct
mistral-large-2411
```

Z.AI GLM IDs (`ZAI_MODELS`, 10) — require `ZAI_API_KEY` (REST) or `ZAI_WEB_ENABLED=1` (web session):

```
glm-5.3-flash
glm-5.3-flashx
glm-5.3
glm-5.2
glm-5.1
glm-5
glm-4.7
glm-4.6
glm-4.7-flash
glm-4.5-flash
```

Web-session pseudo-models (require the matching `*_WEB_ENABLED=1`): `claude-web:default`, `tencent-ai:default`, `gemini-web:default`, `qwen-web:default`.

### Step 3.3: Test Connection
1. In the channel list, locate the newly created `Arena WebBridge` channel.
2. Click **Test** (测试).
3. The gateway will query `/v1/models` and report response latency (typically < 15ms locally).

---

## 4. Configuration in Emo-AI-Gateway

> **Note (source of truth):** This bridge has **no `config.yaml`**. The EMO.ai local gateway UI (`./scripts/EMO.ai` / `npm run emo`) edits a **file-backed JSON store at `~/.arena-webbridge/gateway.json`**, managed in code by `GatewayConfigStore` (`src/gateway/config-store.ts`). Edit it through the UI where possible; `save()` writes atomically (temp file + rename, `0600`).

### Step 4.1: `gateway.json` Shape
The file carries a gateway header, a UI heartbeat setting, and per-web-provider blocks:

```json
{
  "version": 1,
  "gateway": { "port": 8989, "host": "127.0.0.1", "baseUriDisplay": "mac.ai/v1", "apiKey": "<generated>", "requireApiKey": true },
  "ui": { "heartbeatTimeoutMs": 15000 },
  "providers": {
    "arena-browser": {
      "enabled": false,
      "settings": { "baseUrl": "https://arena.ai", "headless": true, "userDataDir": "~/.arena-webbridge/chrome-profile" },
      "availableModels": ["auto"],
      "selectedModels": ["auto"]
    },
    "zai-web": {
      "enabled": false,
      "settings": { "baseUrl": "https://chat.z.ai", "headless": false, "userDataDir": "~/.arena-webbridge/zai-profile", "timeoutMs": 180000, "captchaWaitMs": 180000 },
      "availableModels": ["glm-4.5-flash"],
      "selectedModels": ["glm-4.5-flash"]
    },
    "claude-web": {
      "enabled": false,
      "settings": { "baseUrl": "https://claude.ai", "headless": false, "userDataDir": "~/.arena-webbridge/claude-profile", "timeoutMs": 300000 },
      "availableModels": ["claude-web:default"],
      "selectedModels": ["claude-web:default"]
    },
    "tencent-ai-web": {
      "enabled": false,
      "settings": { "baseUrl": "https://aistudio.tencent.ai", "headless": false, "userDataDir": "~/.arena-webbridge/tencent-ai-profile", "timeoutMs": 300000 },
      "availableModels": ["tencent-ai:default"],
      "selectedModels": ["tencent-ai:default"]
    },
    "gemini-web": {
      "enabled": false,
      "settings": { "baseUrl": "https://gemini.google.com", "headless": false, "userDataDir": "~/.arena-webbridge/gemini-profile", "timeoutMs": 300000 },
      "availableModels": ["gemini-web:default"],
      "selectedModels": ["gemini-web:default"]
    },
    "qwen-web": {
      "enabled": false,
      "settings": { "baseUrl": "https://chat.qwen.ai", "headless": false, "userDataDir": "~/.arena-webbridge/qwen-profile", "timeoutMs": 300000 },
      "availableModels": ["qwen-web:default"],
      "selectedModels": ["qwen-web:default"]
    }
  }
}
```

Defaults above mirror `defaultGatewayConfig()` (`src/gateway/config-store.ts`). A partial file is merged over defaults, so new providers/settings appear even if absent from an older file. As an external OpenAI-compatible upstream from the Emo-AI-Gateway's perspective, point its provider at `http://127.0.0.1:8989/v1` (or `http://host.docker.internal:8989/v1` for Docker) with the gateway `apiKey` from `gateway.json` (or any string if `requireApiKey` is off for local use).

### Step 4.2: Routing Rules (prefix dispatch, not a routes block)
There is **no `routes:` array in `gateway.json`**. Dispatch is by model-ID prefix via the provider registry (`WEB_PROVIDERS` in `src/arena/providers.ts`, first match wins):

| Model prefix | Routes to |
|--------------|-----------|
| `claude-web:` / `claudeai:` | `claude-web` (claude.ai session) |
| `tencent-ai:` / `tencentai:` | `tencent-ai-web` (aistudio.tencent.ai session) |
| `gemini-web:` / `geminiweb:` | `gemini-web` (gemini.google.com session) |
| `qwen-web:` / `qwenweb:` | `qwen-web` (chat.qwen.ai session) |
| `glm-*` (+ `zai-web:`) | Z.AI REST API (`ZAI_API_KEY`) → Z.AI web → Arena fallback |
| everything else | `arena-browser` fallback (canonical Arena IDs such as `claude-3-7-sonnet`, `deepseek-r1`) |

Z.AI canonical IDs are `glm-5.3-flash`, `glm-5.3-flashx`, `glm-5.3`, `glm-5.2`, `glm-5.1`, `glm-5`, `glm-4.7`, `glm-4.6`, `glm-4.7-flash`, `glm-4.5-flash` (`ZAI_MODELS`). In the gateway UI, enable a provider by flipping its `enabled` flag (or the equivalent `*_WEB_ENABLED=1` env var) and keep each provider's `:default` pseudo-model selected to pin the session's current model.

---

## 5. Network & Docker Considerations

### Gateway Running in Docker Container
When your gateway (New API / Emo-AI-Gateway) runs inside Docker and Arena WebBridge runs on the macOS host:

1. **Host Address**: Use `http://host.docker.internal:8989` instead of `http://127.0.0.1:8989`.
2. **Listen Address**: Ensure Arena WebBridge binds to `0.0.0.0` or `127.0.0.1` accessible from Docker:
   ```bash
   HOST=0.0.0.0 ./scripts/run-arena-web.sh
   ```
3. **Docker Compose example**:
   ```yaml
   services:
     new-api:
       image: calciumion/new-api:latest
       ports:
         - "3000:3000"
       extra_hosts:
         - "host.docker.internal:host-gateway"
   ```

---

## 6. End-to-End Verification Through Gateway

Once configured in your gateway, verify by making requests to the gateway's endpoint (e.g. port `3000`):

### Non-Streaming Test
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <GATEWAY_API_TOKEN>" \
  -d '{
    "model": "claude-3-7-sonnet",
    "messages": [
      {"role": "user", "content": "Respond with the single word: WORKING"}
    ]
  }'
```

### Streaming Test (SSE)
```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <GATEWAY_API_TOKEN>" \
  -d '{
    "model": "deepseek-r1",
    "messages": [
      {"role": "user", "content": "Count from 1 to 5."}
    ],
    "stream": true
  }'
```

---

## 7. Troubleshooting

| Issue | Cause | Resolution |
|-------|-------|------------|
| Gateway test fails with connection refused | Gateway cannot reach `127.0.0.1:8989` from inside container | Set base URL to `http://host.docker.internal:8989` and start WebBridge with `HOST=0.0.0.0` |
| `Cloudflare challenge detected` in logs | Browser session expired or Turnstile challenge triggered | Run `./scripts/login-arena-web.sh` to refresh the session interactively |
| Gateway reports timeout (e.g. 30s) | Cold start of browser or model queue delay | Increase upstream timeout in gateway to 60s or 120s |
| Stream breaks abruptly | Gateway proxy buffer buffering chunks | Ensure SSE streaming is enabled in gateway and `proxy_buffering off;` if using Nginx |
