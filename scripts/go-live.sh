#!/usr/bin/env bash
# Serves the backend from this laptop through a Cloudflare quick tunnel and points the Vercel frontend at it.
# Usage: scripts/go-live.sh   (keep it running; Ctrl+C stops the backend and the tunnel)
# shortcut: quick-tunnel URL changes on every start, so each start redeploys Vercel; use a named tunnel if you get a Cloudflare domain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$ROOT/.deploy/web"
LOG="$ROOT/.deploy/tunnel.log"
mkdir -p "$STAGE"

trap 'kill 0' EXIT

npx -y pnpm@12.18.0 -C "$ROOT" -r build
(cd "$ROOT/apps/server" && node --env-file-if-exists=../../.env --import tsx dist/index.js) &
until curl -sf -o /dev/null "http://localhost:${PORT:-4000}/api/config"; do sleep 1; done

: > "$LOG"
cloudflared tunnel --no-autoupdate --url "http://localhost:${PORT:-4000}" > "$LOG" 2>&1 &
until URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1) && [ -n "$URL" ]; do sleep 1; done
until curl -sf -o /dev/null "$URL/api/config"; do sleep 2; done
echo "[go-live] tunnel: $URL"

rsync -a --delete --exclude .vercel "$ROOT/apps/web/dist/" "$STAGE/"
cat > "$STAGE/vercel.json" <<EOF
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "$URL/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
EOF
(cd "$STAGE" && npx -y vercel@latest deploy --prod --yes)
echo "[go-live] live. Keep this terminal open."
wait
