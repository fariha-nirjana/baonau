#!/usr/bin/env bash
# One-command local demo. Starts a fresh local chain (anvil), deploys the whole
# market and an unsigned vault with throwaway keys, and starts the app, which
# opens on the first-time setup. Needs Node 24 and Foundry; no .env needed.
#
#   bash scripts/demo.sh            # app on http://localhost:3002
#   bash scripts/demo.sh --signed   # skip the setup: demo mandate already signed
#   bash scripts/demo.sh --share    # also a password-protected public link
#                                   # (needs SITE_PASSWORD and cloudflared)
#
# Chat needs a model key: LLM_API_KEY=... (and LLM_BASE_URL, LLM_MODEL for a
# provider other than DeepSeek). Everything else works without one.
# Stop everything with Ctrl+C. Each run starts from nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
export PATH="$HOME/.foundry/bin:$PATH"

SIGNED=false
SHARE=false
for arg in "$@"; do
  case "$arg" in
    --signed) SIGNED=true ;;
    --share) SHARE=true ;;
    *) echo "unknown option $arg"; exit 1 ;;
  esac
done

command -v anvil >/dev/null || { echo "Foundry missing: curl -L https://foundry.paradigm.xyz | bash, then foundryup"; exit 1; }
if $SHARE; then
  : "${SITE_PASSWORD:?set SITE_PASSWORD for a shared link, for example SITE_PASSWORD=pick-one}"
  command -v cloudflared >/dev/null || { echo "cloudflared missing: brew install cloudflared"; exit 1; }
fi
[ -d app/node_modules ] || (cd app && npm install)

# Model settings from the project .env if there is one; the rest comes from here.
if [ -z "${LLM_API_KEY:-}" ] && [ -f .env ]; then
  LLM_API_KEY=$(grep -E '^LLM_API_KEY=' .env | cut -d= -f2- || true)
  LLM_BASE_URL=${LLM_BASE_URL:-$(grep -E '^LLM_BASE_URL=' .env | cut -d= -f2- || true)}
  LLM_MODEL=${LLM_MODEL:-$(grep -E '^LLM_MODEL=' .env | cut -d= -f2- || true)}
fi

CHAIN_PORT=${CHAIN_PORT:-8552}
APP_PORT=${APP_PORT:-3002}
export NEXT_DIST_DIR=.next-demo
RPC="http://127.0.0.1:$CHAIN_PORT"
DATA="$ROOT/app/data/demo"
rm -rf "$DATA" && mkdir -p "$DATA"

for port in $CHAIN_PORT $APP_PORT; do
  if lsof -tiTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is in use (an earlier demo still running?). Stop it with:"
    echo "  kill \$(lsof -tiTCP:$port -sTCP:LISTEN)"
    exit 1
  fi
done

# Ctrl+C stops everything this script started, children included.
killtree() { local c; for c in $(pgrep -P "$1"); do killtree "$c"; done; kill "$1" 2>/dev/null || true; }
cleanup() { trap - EXIT INT TERM; for c in $(pgrep -P $$); do killtree "$c"; done; }
trap cleanup EXIT INT TERM

echo "Starting a fresh local chain on port $CHAIN_PORT..."
anvil --port $CHAIN_PORT --block-time 1 --silent &
until cast block-number --rpc-url "$RPC" >/dev/null 2>&1; do sleep 0.5; done

# anvil's well-known test accounts 0 to 3. Public keys, local chain only.
export OWNER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export AGENT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export GUARDIAN_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export ORACLE_UPDATER_PRIVATE_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
export OWNER_ADDRESS=$(cast wallet address $OWNER_PRIVATE_KEY)
export AGENT_ADDRESS=$(cast wallet address $AGENT_PRIVATE_KEY)
export GUARDIAN_ADDRESS=$(cast wallet address $GUARDIAN_PRIVATE_KEY)
export ORACLE_UPDATER_ADDRESS=$(cast wallet address $ORACLE_UPDATER_PRIVATE_KEY)
export LOOSEN_DELAY=120 MAX_PRICE_AGE=3600 ORACLE_MIN_INTERVAL=4 GAS_GIFT_WEI=0 SIGN_MANDATE=$SIGNED

echo "Deploying the contracts..."
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast) > "$DATA/deploy.log" 2>&1 \
  || { echo "Deploy failed:"; tail -20 "$DATA/deploy.log"; exit 1; }
for name in USD ORACLE EXCHANGE IDX BOND GOLD MEME FACTORY MANDATE VAULT; do
  value=$(grep -oE "${name}_ADDRESS=0x[0-9a-fA-F]{40}" "$DATA/deploy.log" | head -1 | cut -d= -f2)
  export "${name}_ADDRESS=$value"
done
export RPC_URL="$RPC" CHAIN_ID=31337 EXPLORER_URL="$RPC" DATA_DIR="$DATA"
export LLM_API_KEY="${LLM_API_KEY:-}" LLM_BASE_URL="${LLM_BASE_URL:-https://api.deepseek.com}" LLM_MODEL="${LLM_MODEL:-deepseek-flash}"
for name in $(env | grep -oE '^(RPC_URL|CHAIN_ID|EXPLORER_URL|DATA_DIR|[A-Z_]+_ADDRESS|[A-Z_]+_PRIVATE_KEY|LOOSEN_DELAY|MAX_PRICE_AGE|ORACLE_MIN_INTERVAL)='); do
  name=${name%=}; printf '%s=%q\n' "$name" "${!name}"
done > "$DATA/local.env"
echo "Vault $VAULT_ADDRESS (settings in app/data/demo/local.env)"

echo "Building the app (about a minute)..."
(cd app && npm run build > "$DATA/build.log" 2>&1) || { echo "Build failed:"; tail -20 "$DATA/build.log"; exit 1; }
if $SHARE; then export SITE_PASSWORD; else unset SITE_PASSWORD; fi
(cd app && exec npx next start -p $APP_PORT > "$DATA/app.log" 2>&1) &
APP_PID=$!
until curl -s -o /dev/null "http://127.0.0.1:$APP_PORT"; do
  kill -0 $APP_PID 2>/dev/null || { echo "The app did not start:"; tail -15 "$DATA/app.log"; exit 1; }
  sleep 0.5
done
[ -z "$LLM_API_KEY" ] && echo "No LLM_API_KEY: everything works except chat."

if $SHARE; then
  echo "Opening the tunnel (takes up to 30 seconds)..."
  cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$APP_PORT" > "$DATA/tunnel.log" 2>&1 &
    URL=""
  for _ in $(seq 1 120); do
    URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$DATA/tunnel.log" | head -1 || true)
    [ -n "$URL" ] && break
    sleep 0.5
  done
  [ -n "$URL" ] || { echo "No link after 60 seconds. cloudflared said:"; tail -15 "$DATA/tunnel.log"; exit 1; }
else
  URL="http://localhost:$APP_PORT"
fi

echo
echo "=============================================================="
echo "  Open:      $URL"
$SHARE && echo "  Password:  $SITE_PASSWORD   (any username)"
echo "=============================================================="
echo "Leave this window open. Ctrl+C stops everything."
wait
