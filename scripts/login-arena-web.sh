#!/usr/bin/env bash
set -euo pipefail

# Resolve script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

if [ -f "$PROJECT_ROOT/dist/cli.js" ]; then
  exec node "$PROJECT_ROOT/dist/cli.js" login "$@"
else
  exec npx tsx "$PROJECT_ROOT/src/cli.ts" login "$@"
fi
