#!/usr/bin/env bash
# Share the app with teammates through a Cloudflare quick tunnel, behind a password.
# Runs against a local fork of Base Sepolia, so nothing teammates click touches
# the real testnet vault, its gas or its evidence log.
#
#   SITE_PASSWORD=something bash scripts/share.sh
#
# Stop everything with Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
export PATH="$HOME/.foundry/bin:$PATH"

: "${SITE_PASSWORD:?set SITE_PASSWORD, for example SITE_PASSWORD=pick-one bash scripts/share.sh}"
command -v cloudflared >/dev/null || { echo "cloudflared missing: brew install cloudflared"; exit 1; }

set -a; source "$ROOT/.env"; set +a
FORK_PORT=8551
APP_PORT=3002
DATA="$ROOT/app/data/share"
mkdir -p "$DATA"
[ -f "$ROOT/app/data/plan.json" ] && [ ! -f "$DATA/plan.json" ] && cp "$ROOT/app/data/plan.json" "$DATA/"

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Starting a fork of Base Sepolia on port $FORK_PORT..."
anvil --fork-url "$RPC_URL" --port $FORK_PORT --block-time 1 --silent &
pids+=($!)
FORK="http://127.0.0.1:$FORK_PORT"
until cast block-number --rpc-url "$FORK" >/dev/null 2>&1; do sleep 0.5; done
# anvil's priority fee is higher than Base Sepolia's, so give the role keys gas.
for a in "$OWNER_ADDRESS" "$AGENT_ADDRESS" "$GUARDIAN_ADDRESS" "$ORACLE_UPDATER_ADDRESS"; do
  cast rpc anvil_setBalance "$a" 0xDE0B6B3A7640000 --rpc-url "$FORK" >/dev/null
done

echo "Building the app..."
(cd app && npm run build >/dev/null)
echo "Starting the app on port $APP_PORT..."
(cd app && RPC_URL="$FORK" DATA_DIR="$DATA" SITE_PASSWORD="$SITE_PASSWORD" npx next start -p $APP_PORT) &
pids+=($!)
until curl -s -o /dev/null "http://127.0.0.1:$APP_PORT"; do sleep 0.5; done

echo "Opening the tunnel (takes up to 30 seconds)..."
TUNNEL_LOG="$DATA/tunnel.log"
: > "$TUNNEL_LOG"
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$APP_PORT" >"$TUNNEL_LOG" 2>&1 &
pids+=($!)
URL=""
for _ in $(seq 1 120); do
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$TUNNEL_LOG" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.5
done
if [ -z "$URL" ]; then
  echo "No link after 60 seconds. cloudflared said:"; tail -15 "$TUNNEL_LOG"; exit 1
fi
echo
echo "=============================================================="
echo "  Link:      $URL"
echo "  Password:  $SITE_PASSWORD   (any username)"
echo "=============================================================="
echo "Leave this window open. Ctrl+C stops everything."
wait
