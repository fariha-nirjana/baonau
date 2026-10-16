#!/usr/bin/env bash
# Share the app with teammates: a fresh local demo behind a password, through a
# Cloudflare quick tunnel. Nothing touches the testnet vault.
#
#   SITE_PASSWORD=something bash scripts/share.sh            # starts at the setup walkthrough
#   SITE_PASSWORD=something bash scripts/share.sh --signed   # mandate already signed
exec bash "$(dirname "$0")/demo.sh" --share "$@"
