#!/bin/bash
# Arena WebBridge — launcher (macOS double-click, no Apple Developer account needed)
#
# Usage: double-click this file in Finder (or ./Arena WebBridge.command)
# Behavior:
#   1. Finds node (PATH, nvm, /opt/homebrew, /usr/local)
#   2. Builds dist/ if missing (npm run build)
#   3. Starts EMO.ai gateway hidden (dist/emo-ai.js --no-open)
#   4. Opens the management UI in your browser
#   5. Watches the UI heartbeat. If the browser UI closes (or heartbeats stop
#      for ~20s), the gateway stops automatically and this window closes.
#   6. Press Ctrl+C in this Terminal window at any time to stop manually.
#
# No DMG, no signing, no admin rights. They double-click once to uninstall (optional).

set -uo pipefail

# Resolve project root = folder containing this .command file (or scripts/ parent)
DIR="$(cd "$(dirname "$0")" && pwd)"
# Allow running from repo root or from scripts/ folder
if [ ! -f "$DIR/package.json" ] && [ -f "$DIR/../package.json" ]; then
  DIR="$(cd "$DIR/.." && pwd)"
fi
cd "$DIR"

echo "=== Arena WebBridge ==="
echo "Project: $DIR"

# 1. Find node
NODE=""
if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  for p in "$HOME/.nvm/versions/node/v26.*/bin/node" "$HOME/.nvm/versions/node/v24.*/bin/node" "$HOME/.nvm/versions/node/v22.*/bin/node" "$HOME/.nvm/versions/node"/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -x "$p" ]; then NODE="$p"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "❌ node not found. Install Node.js 20+ (https://nodejs.org), then double-click again."
  read -r -p "Press Enter to close…"; exit 1
fi
echo "✅ node: $($NODE --version) ($NODE)"

# Find npm (sibling of node)
NPM="$(dirname "$NODE")/npm"
if [ ! -x "$NPM" ]; then NPM="$(command -v npm 2>/dev/null || true)"; fi

# 2. Build if dist missing
if [ ! -f "$DIR/dist/emo-ai.js" ]; then
  echo "Building dist/ (first run)…"
  if [ -x "$NPM" ]; then
    "$NPM" run build || { echo "❌ build failed."; read -r -p "Enter to close…"; exit 1; }
  else
    echo "❌ npm not found and dist/ missing. Run: npm run build once, then double-click again."
    read -r -p "Enter to close…"; exit 1
  fi
fi

# 3. Read gateway config (port + api key) without exposing it
GW_FILE="$HOME/.arena-webbridge/gateway.json"
PORT=8989
API_KEY=""
if [ -f "$GW_FILE" ]; then
  PORT="$(/usr/bin/python3 -c "import json,sys; print(json.load(open('$GW_FILE')).get('gateway',{}).get('port',8989))" 2>/dev/null || echo 8989)"
  API_KEY="$(/usr/bin/python3 -c "import json; print(json.load(open('$GW_FILE')).get('gateway',{}).get('apiKey',''))" 2>/dev/null || echo "")"
fi

# 4. Start gateway in background
echo "Starting gateway on 127.0.0.1:$PORT …"
"$NODE" "$DIR/dist/emo-ai.js" --no-open > "$DIR/.arena-gateway.log" 2>&1 &
PID=$!
echo "Gateway PID: $PID (log: .arena-gateway.log)"

cleanup() {
  echo ""
  echo "Stopping gateway…"
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  echo "Stopped. This window will close."
  # Auto-close Terminal window after Ctrl+C (macOS). Harmless if already closing.
  osascript -e 'tell application "System Events" to (get name of first process whose frontmost is true)' 2>/dev/null >/dev/null || true
  [ -z "${KEEP_OPEN:-}" ] && sleep 1
  # Single-quit: if invoked via Terminal app, ask Terminal to close this tab
  osascript -e 'tell application "Terminal" to close first window' 2>/dev/null >/dev/null || true
}
trap cleanup EXIT INT TERM

# 5. Wait for server to be ready (max 15s)
for i in $(seq 1 30); do
  if curl -s --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null; then break; fi
  sleep 0.5
done

# 6. Open UI
echo "Opening UI in browser: http://127.0.0.1:$PORT/"
open "http://127.0.0.1:$PORT/"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  UI is open in your browser."
echo "  Close the browser tab/window — the gateway will"
echo "  stop automatically within ~20 seconds."
echo "  (Or press Ctrl+C here anytime.)"
echo "═══════════════════════════════════════════════════"
echo ""

# 7. Watch heartbeat. /api/gateway/status reports sessionActive=false
#    after heartbeatTimeoutMs (15s) with no UI. Require ~30s of inactivity
#    after the first heartbeat to avoid killing a slow-to-load page.
START=$(date +%s)
MISS=0
WARM=0
while true; do
  # Is the gateway process still alive?
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Gateway process exited."
    break
  fi

  if [ -n "$API_KEY" ]; then
    STATUS="$(curl -s --max-time 3 -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$PORT/api/gateway/status" 2>/dev/null || echo "")"
  else
    STATUS="$(curl -s --max-time 3 "http://127.0.0.1:$PORT/api/gateway/status" 2>/dev/null || echo "")"
  fi

  NOW=$(date +%s)
  ELAPSED=$(( NOW - START ))

  # Extract sessionActive (true/false) without jq
  ACTIVE="$(echo "$STATUS" | /usr/bin/python3 -c "import json,sys; d=json.load(sys.stdin); print(str(d.get('usage',{}).get('sessionActive',False)).lower())" 2>/dev/null || echo "")"

  if [ "$ACTIVE" = "true" ]; then
    WARM=1
    MISS=0
  elif [ "$WARM" = "1" ] && [ "$ELAPSED" -gt 30 ]; then
    MISS=$(( MISS + 1 ))
  fi

  # ~20-25s of no UI after warm -> auto-stop
  if [ "$MISS" -ge 5 ]; then
    echo "Browser UI closed (no heartbeat for ~20s). Stopping gateway…"
    break
  fi

  sleep 4
done

echo "Done."
