# agent-bridge-check — live verification of the agent ↔ web-model tool bridge

`scripts/agent-bridge-check.ts` is a **live** harness that answers one question:

> When an agent (OpenCode, Cline, …) announces its tools to the gateway, does the
> **web model** (ChatGPT driven through a real browser) actually emit an OpenAI-style
> `tool_calls` response — instead of answering in prose and pretending the filesystem
> is unreachable?

It is the end-to-end check of the mechanism the whole project depends on.

## How it works

For every scenario (agent tool set × task) the harness sends one HTTP request to the
running gateway — **no browser code of its own**:

```
POST http://127.0.0.1:8989/v1/chat/completions
Authorization: Bearer <api key>
Content-Type: application/json

{
  "model": "chatgpt-web:default",
  "messages": [{ "role": "user", "content": "<task>" }],
  "tools": [ ...the agent's tool schemas... ],
  "tool_choice": "auto",
  "stream": false
}
```

The answer is classified:

| Status        | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `TOOL_CALL`   | A tool call was emitted, the tool is the expected one, and the arguments validate against the tool schema (every argument name exists in `parameters.properties`, every required property is present). |
| `WRONG_TOOL`  | A tool call was emitted, but the tool is not the expected one (e.g. `bash` instead of `list`). |
| `BAD_ARGS`    | The expected tool was called, but the arguments violate the schema (unknown property or missing required property). |
| `TEXT`        | The model answered in prose — no tool call at all. The first 120 characters are recorded. |
| `ERROR`       | The request failed: HTTP status, timeout, non-JSON body, …                    |

The **TOOL_CALL rate** is `TOOL_CALL / scenarios`. The raw rate (any tool call,
including `WRONG_TOOL`/`BAD_ARGS`) is printed as extra information.

## Scenarios

Two tool sets, mirroring the real clients, and four tasks on a path that exists on
this machine (`/Users/emamabdullaziz/Desktop/Doctor-Car`):

| Tool set  | Tools |
| --------- | ----- |
| `opencode` | `bash`, `edit`, `glob`, `grep`, `list`, `patch`, `read`, `read_file`, `todowrite`, `todoread`, `webfetch`, `write` |
| `cline`    | `read_file`, `list_files`, `list_codebase`, `search_files`, `write_file`, `execute_command` |

| Task      | Prompt (EN / AR)                             | Expected tool           |
| --------- | -------------------------------------------- | ----------------------- |
| `dir-en`  | `Read the files in …/Doctor-Car`              | a listing tool (`list` / `list_files` / `list_codebase`) |
| `dir-ar`  | `اقرأ ملفات المشروع في …/Doctor-Car`           | a listing tool          |
| `file-en` | `Read the file …/Doctor-Car/README.md`        | a reading tool (`read` / `read_file`) |
| `file-ar` | `اقرأ الملف …/Doctor-Car/README.md`           | a reading tool          |

Expected tools are intersected with the tool set of the scenario, so e.g. `cline`
expects `list_files`/`list_codebase` for a directory task and `read_file` for a
file task.

## Running it

The gateway must be running on `http://127.0.0.1:8989`:

```bash
cd /Users/emamabdullaziz/Desktop/web
npm run build && nohup node dist/emo-ai.js --no-open > .arena-gateway.log 2>&1 &
```

Then:

```bash
# full matrix (8 scenarios, a few minutes — a real browser answers each one)
npx tsx scripts/agent-bridge-check.ts

# a single scenario
npx tsx scripts/agent-bridge-check.ts --scenarios opencode:dir-en

# a subset
npx tsx scripts/agent-bridge-check.ts --scenarios opencode:dir-en,cline:file-ar

# machine readable
npx tsx scripts/agent-bridge-check.ts --json

# stricter / more patient
npx tsx scripts/agent-bridge-check.ts --min-rate 0.9 --timeout 600000
```

### Options

| Flag             | Default                 | Meaning                                        |
| ---------------- | ----------------------- | ---------------------------------------------- |
| `--scenarios <ids>` | all (8)              | Comma separated scenario ids (`toolset:task`), or `all`. |
| `--timeout <ms>` | `300000`                | Per-request timeout. Each request drives a real browser, so 10–60 s is normal. |
| `--min-rate <r>` | `0.8`                   | Minimum TOOL_CALL rate required to exit `0`.   |
| `--json`        | off                     | Print the results as JSON (progress goes to stderr). |
| `--base-url <url>` | `http://127.0.0.1:8989` | Gateway base URL — **loopback only**.          |
| `--model <id>`  | `chatgpt-web:default`   | Model id to request.                           |

The API key defaults to `emo.web` and can be overridden with the
`EMO_GATEWAY_API_KEY` environment variable. It is **never printed**; any accidental
occurrence in printed text is redacted as `***`.

The timeout is enforced by a race against a deadline, not only by the abort signal,
so a stalled response body can never keep the harness hanging past `--timeout`.

## Reading the output

```
SCENARIO         STATUS     TOOL  ARGUMENTS                                            DETAIL
---------------  ---------  ----  ---------------------------------------------------  ------
opencode:dir-en  TOOL_CALL  list  {"path":"/Users/emamabdullaziz/Desktop/Doctor-Car"}
cline:file-ar    TEXT       -     -                                                   -ng("/Users/emam/Desktop/Doctor-Car/README.md") is not a valid…
```

* `TOOL` — the tool the model asked for.
* `ARGUMENTS` — the parsed arguments object (JSON).
* `DETAIL` — for `TEXT`, the first 120 characters of the prose answer; for
  `WRONG_TOOL` / `BAD_ARGS` / `ERROR`, the reason.

The summary prints the TOOL_CALL rate, the raw tool-call rate, the per-status
counts and `PASS` / `FAIL`. A progress line is printed before every request and
after every result, so a long run is never silent. When some scenarios ended in
`ERROR`, the summary adds a `note` line naming them — transport errors mean the
request never reached the web model (gateway/browser restart, 503, timeout), so
they must not be read as tool-bridge failures.

**Exit code**: `0` when the TOOL_CALL rate is `>= --min-rate`, `1` when it is below,
`2` for a usage/argument error.

## What a failure means

| Symptom                                | What it usually means |
| -------------------------------------- | --------------------- |
| `TEXT` on every scenario               | The web model ignored the injected tool protocol and answered in prose — the classic "the file environment is disconnected" failure. The agent bridge is not reaching the model. |
| `TEXT` only on the Arabic tasks        | An Arabic task is not understood as a local-inspection task, so no tool call is requested. Check the prompt-injection wording, not the tool schemas. |
| `WRONG_TOOL` (e.g. `bash` for a listing)| The model called *a* tool, but not the one matching the task. Usually a tool-description/selection problem: the tool names and descriptions are too similar or the schema was over-compressed. |
| `BAD_ARGS`                             | The right tool was called with arguments that do not satisfy the schema (unknown property, missing required property). The model is not reading the schema correctly — the injected schema block needs more detail. |
| `ERROR` with `HTTP 401`                | The API key is wrong or the gateway requires auth for `/v1/*`. |
| `ERROR` with `HTTP 503`                | The gateway service is stopped in the dashboard (the gateway refuses generation calls while stopped). |
| `ERROR` with `timeout after Nms`       | The browser/web chat did not answer in time. The request is still running on the gateway side — check `.arena-gateway.log`. |
| `ERROR` with `non-JSON response`       | Something other than the gateway answered on that port. |

The harness is safe to run twice in a row: it is stateless, writes nothing to disk
and leaves no temp files behind.

## Environment caveats

* **Keep the machine awake.** On macOS the laptop can enter *Maintenance Sleep*
  in the middle of a run. The timer then fires late and every duration is
  inflated (a 20 s timeout was observed firing after 301 s, because
  `pmset -g log` showed a 301 s sleep). Run the matrix under `caffeinate`:
  ```bash
  caffeinate -i npx tsx scripts/agent-bridge-check.ts
  ```
* The gateway and the browser session behind it are shared resources. If the
  gateway is restarted (or the browser is closed) **while the matrix runs**, the
  affected scenarios end as `ERROR` with `HTTP 500`, `HTTP 503` or a
  `fetch failed` — the request never reached the web model. Re-run those
  scenarios with `--scenarios` once the gateway is stable again.
* The web model is stochastic: the same scenario can produce a tool call in one
  run and prose in the next. A single failing scenario is not a verdict — look at
  the whole matrix.
