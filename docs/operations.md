# Operations Runbook — Arena WebBridge (`arena-web-api`)

Verified local runbook for build → login → serve → verify. All commands below are taken verbatim from `package.json` scripts, `scripts/*.sh`, and `src/cli.ts` / `src/server/app.ts` behavior.

## 0. Prerequisites

| Requirement | Source |
|---|---|
| Node.js `>=20` | `package.json` → `"engines": { "node": ">=20" }` |
| Google Chrome (or Playwright Chromium) | `README.md` installation section |
| Default port / host | `src/config.ts` → `DEFAULT_CONFIG`: `port: 8989`, `host: '127.0.0.1'` |
| Default Chrome profile dir | `src/config.ts` → `~/.arena-webbridge/chrome-profile` |

Install dependencies (once):

```bash
npm ci
# or: npm install
```

## 1. Build

Exact command from `package.json`:

```bash
npm run build
# -> tsc && chmod +x dist/cli.js dist/emo-ai.js 2>/dev/null || (tsc && chmod +x dist/cli.js)
```

Expected output: TypeScript compiles `src/**/*` per `tsconfig.json` and produces `dist/cli.js` (plus `dist/emo-ai.js`, `dist/index.js`, ...). If this step fails, do not proceed to serve with `dist/` — the runner scripts fall back to `tsx` source mode, but a broken `tsc` means a broken release.

## 2. Login (interactive, first time)

Choose one of the following — they are equivalent entry points:

```bash
# Equivalent forms (all run `login` subcommand from src/cli.ts):
npm run login
# -> tsx src/cli.ts login

./scripts/login-arena-web.sh
# -> node dist/cli.js login        (if dist/cli.js exists)
# -> npx tsx src/cli.ts login    (fallback)

npx webbridge login
```

What happens (per `src/cli.ts` → `login` command):

1. `BrowserManager.launchLogin()` opens a visible Chrome window to `config.arenaBaseUrl` (default `https://arena.ai`).
2. Solve any Cloudflare Turnstile challenge or log in with Google/GitHub.
3. Close the window (or press `Ctrl+C`). Session cookies are persisted to `--user-data-dir` (default `~/.arena-webbridge/chrome-profile`).

Verify session data was saved:

```bash
npx webbridge status
# === Arena WebBridge Profile Status ===
# Profile Directory: /Users/<you>/.arena-webbridge/chrome-profile
# Directory Exists:  Yes
# Session Data:      Found (authenticated / active session)

npx webbridge status --json
```

If `Session Data: Not found`, re-run `login` before serving.

## 3. Serve (`serve` — default command)

Requires `dist/cli.js` to exist (for `node dist/cli.js` path) or falls back to `tsx`:

```bash
# Equivalent forms:
npm start
# -> tsx src/cli.ts serve

./scripts/run-arena-web.sh
# -> node dist/cli.js serve --port "$PORT" --host "$HOST"   (if dist/cli.js exists)
# -> npx tsx src/cli.ts serve --port "$PORT" --host "$HOST"   (fallback)

npx webbridge serve --port 8989
```

Configuration (precedence: CLI flag > env var > default, from `src/config.ts::loadConfig` + `src/cli.ts::serve`):

| Flag / CLI option | Env var | Default | Notes |
|---|---|---|---|
| `-p, --port <port>` | `ARENA_PORT` / `PORT` | `8989` | `scripts/run-arena-web.sh` resolves `PORT="${ARENA_PORT:-${PORT:-8989}}"` |
| `-h, --host <host>` | `HOST` | `127.0.0.1` | |
| `--user-data-dir <dir>` | `USER_DATA_DIR` | `~/.arena-webbridge/chrome-profile` | |
| `--headless <boolean>` | `HEADLESS` | `true` | `true`/`false` |
| — (login only) `--url <url>` | `ARENA_BASE_URL` | `https://arena.ai` | |
| — | `ZAI_API_KEY` | _(empty)_ | enables `glm-*` via Z.AI REST instead of Arena browser |

Examples:

```bash
ARENA_PORT=9000 ./scripts/run-arena-web.sh
./scripts/run-arena-web.sh --port 8989 --host 127.0.0.1
export ZAI_API_KEY="your-zai-key" && ./scripts/run-arena-web.sh
```

Stop: `Ctrl+C` (`SIGINT`/`SIGTERM` handlers in `src/cli.ts` close the Fastify app and the driver, then `process.exit(0)`).

Expected startup log (`src/cli.ts::serve`):

```
Arena WebBridge listening at http://127.0.0.1:8989/v1
```

## 4. Verify

Run these against the listening host/port (defaults `http://127.0.0.1:8989`). Routes are defined in `src/server/app.ts::createServer`.

### 4.1 Liveness — `/health`

```bash
curl -s http://127.0.0.1:8989/health
# {"status":"ok","service":"arena-web-api"}
```

Definition: `app.get('/health', async () => ({ status: 'ok', service: 'arena-web-api' }))`. No driver call — returns `200` even if the browser session is stale.

### 4.2 Readiness — `/ready`

```bash
curl -s http://127.0.0.1:8989/ready
# {"status":"ready","service":"arena-web-api","models":<N>}
```

Definition: `GET /ready` calls `await driver.listModels()`. Returns `200` with `{status:'ready', models: <count>}` on success, or `503` with `{status:'not_ready', error:{message}}` if the driver is unavailable. Use this (not `/health`) as the gate before sending traffic.

### 4.3 Models — `/v1/models`

```bash
curl -s http://127.0.0.1:8989/v1/models
# {"object":"list","data":[{"id":"claude-3-7-sonnet","object":"model",...}, ...]}

# CLI equivalent:
npx webbridge models
npx webbridge models --json
```

Definition: `app.get('/v1/models', ...)` → `formatModelList(await driver.listModels())`.

### 4.4 Chat smoke test (optional)

```bash
curl -s http://127.0.0.1:8989/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer any-key" \
  -d '{"model":"claude-3-7-sonnet","messages":[{"role":"user","content":"ping"}]}'
```

## 5. Tests & CI

```bash
# Local validation (same steps as .github/workflows/ci.yml):
npm run build
npm test
# -> vitest run

# Type-check tests (also runs in CI):
npx tsc --noEmit -p tsconfig.test.json
# or: tsc --noEmit -p tsconfig.test.json
```

`tsconfig.test.json` extends `tsconfig.json` with `include: ["src/**/*", "tests/**/*"]` and `noEmit: true`, so the exact same compiler options cover both source and test files without emitting JS.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `PORT` / `ARENA_PORT` already in use | `lsof -i :8989` and kill, or serve on another port: `ARENA_PORT=9000 ./scripts/run-arena-web.sh` |
| `Session Data: Not found` | Re-run `npm run login` / `./scripts/login-arena-web.sh`, complete Cloudflare/login in the visible window, then `npx webbridge status` again |
| `/health` OK but `/ready` returns `503` | Driver cannot list models — usually stale/expired Arena session. Re-run `login` and restart `serve` |
| `403 recaptcha` / `429 rate limit` from Arena | Set `ZAI_API_KEY` to route `glm-*` via Z.AI REST (bypasses browser); Arena quota itself is a free-account limit |
