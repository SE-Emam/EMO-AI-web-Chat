#!/usr/bin/env bash
set -euo pipefail

# Interactive z.ai (chat.z.ai) session setup: sign in + solve security verifications by hand.
# The session persists into ~/.arena-webbridge/zai-profile so the headless API bridge
# never has to (and never will) bypass captchas programmatically.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

export PATH="/Users/emamabdullaziz/.nvm/versions/node/v26.7.0/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

ZAI_PROFILE_DIR="${ZAI_WEB_USER_DATA_DIR:-$HOME/.arena-webbridge/zai-profile}"
ARENA_PROFILE_DIR="${USER_DATA_DIR:-$HOME/.arena-webbridge/chrome-profile}"
ZAI_URL="${ZAI_WEB_BASE_URL:-https://chat.z.ai}"

# Bootstrap: seed the z.ai profile from the Arena profile so the Google session
# (and Chrome fingerprint) rides along — one-click "Continue with Google".
if [ ! -d "$ZAI_PROFILE_DIR/Default" ] && [ -d "$ARENA_PROFILE_DIR/Default" ]; then
  echo "Seeding z.ai profile from the Arena profile (inherits your signed-in Google session)..."
  mkdir -p "$ZAI_PROFILE_DIR"
  cp -R "$ARENA_PROFILE_DIR/." "$ZAI_PROFILE_DIR/"
  rm -f "$ZAI_PROFILE_DIR/Singleton"*
fi

mkdir -p "$ZAI_PROFILE_DIR"

echo "Opening chat.z.ai in a visible Chrome window."
echo "  1) Sign in (Continue with Google / Email / GitHub)."
echo "  2) If a 'Please complete security verification' slider appears, drag it by hand."
echo "  3) Send any test message to confirm the chat works."
echo "  4) Close the window when done — the session is saved."

if [ -f "$PROJECT_ROOT/dist/cli.js" ]; then
  node - "$ZAI_PROFILE_DIR" "$ZAI_URL" <<'EOF'
const path = process.argv[2];
const url = process.argv[3];
const { chromium } = require('playwright');
(async () => {
  const ctx = await chromium.launchPersistentContext(path, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  // Keep the window open until the user closes it.
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (ctx.pages().length === 0) { clearInterval(check); resolve(); }
    }, 1000);
  });
  console.log('Window closed — z.ai session saved.');
  await ctx.close().catch(() => {});
})();
EOF
else
  npx tsx "$PROJECT_ROOT/src/scripts/login-zai.tsx" 2>/dev/null || {
    echo "Build the project first: npm run build";
    exit 1;
  }
fi
