#!/usr/bin/env bash
set -euo pipefail

# Resolve script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

PORT="${ARENA_PORT:-${PORT:-8989}}"
HOST="${HOST:-127.0.0.1}"

if [ -f "$PROJECT_ROOT/dist/cli.js" ]; then
  exec node "$PROJECT_ROOT/dist/cli.js" serve --port "$PORT" --host "$HOST" "$@"
else
  exec npx tsx "$PROJECT_ROOT/src/cli.ts" serve --port "$PORT" --host "$HOST" "$@"
fi
