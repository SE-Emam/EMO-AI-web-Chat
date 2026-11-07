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

Arena WebBridge exposes an OpenAI-compliant HTTP API (`/v1/chat/completions`, `/v1/models`, `/health`). Multi-tenant gateways can route requests for leading frontier models (Claude 3.7 Sonnet, DeepSeek R1, GPT-4o, Gemini 2.0 Flash) through Arena WebBridge without requiring paid API keys.

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

### Step 3.3: Test Connection
1. In the channel list, locate the newly created `Arena WebBridge` channel.
2. Click **Test** (测试).
3. The gateway will query `/v1/models` and report response latency (typically < 15ms locally).

---

## 4. Configuration in Emo-AI-Gateway

### Step 4.1: Upstream Provider Configuration
In Emo-AI-Gateway's provider configuration file (`config.yaml` or UI):

```yaml
providers:
  - id: arena-webbridge
    name: "Arena WebBridge Local"
    type: openai
    base_url: "http://127.0.0.1:8989/v1"  # Or http://host.docker.internal:8989/v1 for Docker
    api_key: "sk-arena-local"
    timeout_seconds: 120
    models:
      - id: "claude-3-7-sonnet"
        display_name: "Claude 3.7 Sonnet (Arena)"
        stream: true
      - id: "deepseek-r1"
        display_name: "DeepSeek R1 (Arena)"
        stream: true
      - id: "gpt-4o"
        display_name: "GPT-4o (Arena)"
        stream: true
      - id: "gemini-2.0-flash"
        display_name: "Gemini 2.0 Flash (Arena)"
        stream: true
```

### Step 4.2: Routing Rule Definition
Configure routing to prioritize Arena WebBridge for specific models or fallbacks:

```yaml
routes:
  - model: "claude-3-7-sonnet"
    strategy: priority
    targets:
      - provider: arena-webbridge
        weight: 100
      - provider: official-anthropic
        weight: 0
        fallback_on: [500, 502, 503, 504]
```

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
