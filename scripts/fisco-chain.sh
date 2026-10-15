#!/usr/bin/env bash
# Builds a one-node FISCO BCOS 3.x chain on this machine and prepares it for the
# contracts in contracts/. Native binaries, no Docker. Tested on macOS (Apple
# silicon) with FISCO BCOS 3.16.4 and console 3.8.0 (needs Java).
#
#   scripts/fisco-chain.sh            build and start the chain in ~/fisco
#   scripts/fisco-chain.sh stop       stop it
#
# Then deploy exactly as on Base Sepolia:
#   cd contracts && GAS_GIFT_WEI=0 forge script script/Deploy.s.sol \
#     --rpc-url http://127.0.0.1:8545 --broadcast --legacy --slow
#
# Three settings differ from a default FISCO chain, and each one is needed:
#  - the Ethereum-compatible RPC (web3_rpc) is switched on, so Foundry and viem talk to it unchanged
#  - feature_evm_timestamp: block.timestamp in seconds, as on Ethereum (FISCO's default is
#    milliseconds, which would break every waiting period, price age and key expiry)
#  - feature_balance: FISCO's web3 RPC refuses senders whose native balance is zero, even with a
#    gas price of 0, so the four role keys are credited once by a balance governor
set -euo pipefail

VERSION=3.16.4
CONSOLE_VERSION=3.8.0
DIR="${FISCO_DIR:-$HOME/fisco}"
NODE="$DIR/nodes/127.0.0.1"
root="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${1:-}" = "stop" ]; then
  bash "$NODE/stop_all.sh"
  exit 0
fi

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) asset=fisco-bcos-macOS-arm.tar.gz ;;
  Darwin-x86_64) asset=fisco-bcos-macOS-x86_64.tar.gz ;;
  Linux-aarch64) asset=fisco-bcos-linux-aarch64.tar.gz ;;
  Linux-x86_64) asset=fisco-bcos-linux-x86_64.tar.gz ;;
  *) echo "No FISCO BCOS binary for this platform" >&2; exit 1 ;;
esac

set -a
# shellcheck disable=SC1091
source "$root/.env"
set +a

mkdir -p "$DIR"
cd "$DIR"
[ -f fisco-bcos ] || { curl -sSLO "https://github.com/FISCO-BCOS/FISCO-BCOS/releases/download/v$VERSION/$asset" && tar xzf "$asset"; }
[ -f build_chain.sh ] || curl -sSL -o build_chain.sh "https://raw.githubusercontent.com/FISCO-BCOS/FISCO-BCOS/v$VERSION/tools/BcosAirBuilder/build_chain.sh"
[ -d console ] || { curl -sSL -o console.tar.gz "https://github.com/FISCO-BCOS/console/releases/download/v$CONSOLE_VERSION/console.tar.gz" && tar xzf console.tar.gz; }

if [ -d nodes ]; then
  echo "$DIR/nodes already exists. Remove it to build a fresh chain." >&2
  exit 1
fi
bash build_chain.sh -l 127.0.0.1:1 -p 30300,20200 -e ./fisco-bcos

# web3 RPC on, local only
perl -0pi -e 's/\[web3_rpc\]\n    enable=false/[web3_rpc]\n    enable=true/' "$NODE/node0/config.ini"
perl -pi -e 's/listen_ip=0.0.0.0/listen_ip=127.0.0.1/' "$NODE/node0/config.ini"
# features in genesis, before the first start
printf '[features]\n    feature_balance=1\n    feature_balance_precompiled=1\n    feature_evm_timestamp=1\n' >> "$NODE/node0/config.genesis"
bash "$NODE/start_all.sh"
sleep 5

# the console signs as the chain's admin account, which is the governor on a fresh chain
admin_pem="$(ls "$DIR"/nodes/ca/accounts/0x*.pem | grep -v pub | head -1)"
admin="$(basename "$admin_pem" .pem)"
cp -r "$NODE"/sdk/* console/conf/
cp console/conf/config-example.toml console/conf/config.toml
perl -pi -e "s|^# accountFilePath = \"\"|accountFilePath = \"$admin_pem\"|" console/conf/config.toml

printf '%s\n' \
  "registerBalanceGovernor $admin" \
  "addBalance $OWNER_ADDRESS 1000 ether" \
  "addBalance $AGENT_ADDRESS 1000 ether" \
  "addBalance $GUARDIAN_ADDRESS 1000 ether" \
  "addBalance $ORACLE_UPDATER_ADDRESS 1000 ether" \
  quit | (cd console && bash start.sh) | grep -E "success|error|fail" || true

echo
echo "FISCO BCOS is running. Ethereum-compatible RPC: http://127.0.0.1:8545 (chain id 20200)"
