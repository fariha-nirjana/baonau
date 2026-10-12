#!/usr/bin/env bash
# Generates fresh testnet keys and writes .env at the repo root.
# Prints addresses only. Refuses to overwrite an existing .env.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$root/.env"

if [ -e "$env_file" ]; then
  echo ".env already exists, not overwriting: $env_file" >&2
  exit 1
fi

new_wallet() { cast wallet new --json; }
# cast has printed both a bare list and a {"data": [...]} wrapper, so accept either
field() {
  python3 -c 'import json,sys
d = json.load(sys.stdin)
d = d["data"] if isinstance(d, dict) else d
print(d[0][sys.argv[1]])' "$1"
}

owner="$(new_wallet)"
guardian="$(new_wallet)"
agent="$(new_wallet)"
updater="$(new_wallet)"

owner_key="$(field private_key <<<"$owner")"
owner_addr="$(field address <<<"$owner")"
guardian_key="$(field private_key <<<"$guardian")"
guardian_addr="$(field address <<<"$guardian")"
agent_key="$(field private_key <<<"$agent")"
agent_addr="$(field address <<<"$agent")"
updater_key="$(field private_key <<<"$updater")"
updater_addr="$(field address <<<"$updater")"

umask 077
cat > "$env_file" <<EOF
RPC_URL=https://sepolia.base.org
CHAIN_ID=84532
EXPLORER_URL=https://sepolia.basescan.org

OWNER_PRIVATE_KEY=$owner_key
OWNER_ADDRESS=$owner_addr
GUARDIAN_PRIVATE_KEY=$guardian_key
GUARDIAN_ADDRESS=$guardian_addr
AGENT_PRIVATE_KEY=$agent_key
AGENT_ADDRESS=$agent_addr

ORACLE_UPDATER_PRIVATE_KEY=$updater_key
ORACLE_UPDATER_ADDRESS=$updater_addr

LOOSEN_DELAY=120
MAX_PRICE_AGE=3600
ORACLE_MIN_INTERVAL=4

USD_ADDRESS=
ORACLE_ADDRESS=
EXCHANGE_ADDRESS=
IDX_ADDRESS=
BOND_ADDRESS=
GOLD_ADDRESS=
MEME_ADDRESS=
VAULT_ADDRESS=

LLM_API_KEY=
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-flash
EOF

# forge reads .env from the contracts folder, Next.js reads .env.local from the app folder
ln -sf ../.env "$root/contracts/.env"
if [ -d "$root/app" ]; then ln -sf ../.env "$root/app/.env.local"; fi

echo "Wrote $env_file"
grep '_ADDRESS=0x' "$env_file"
