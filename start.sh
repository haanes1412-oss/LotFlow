#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required: https://nodejs.org/"
  exit 1
fi

read -r -p "LZT API token (press Enter for demo mode): " LZT_TOKEN
export LZT_TOKEN
export LZT_CURRENCY="${LZT_CURRENCY:-rub}"
npm start
