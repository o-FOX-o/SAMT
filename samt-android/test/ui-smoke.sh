#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
browser="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
python3 -m http.server 8765 --bind 127.0.0.1 --directory web >/tmp/samt-http.log 2>&1 &
server_pid=$!
profile="$(mktemp -d)"
browser_pid=''
trap 'kill "$server_pid" "$browser_pid" 2>/dev/null || true; rm -rf "$profile"' EXIT
for n in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:8765/index.html >/dev/null; then break; fi
  sleep 1
done
"$browser" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --no-first-run --no-default-browser-check --user-data-dir="$profile" \
  about:blank >/tmp/samt-chrome.log 2>&1 &
browser_pid=$!
if ! node test/ui-smoke.cjs; then
  tail -n 120 /tmp/samt-http.log /tmp/samt-chrome.log || true
  exit 1
fi
