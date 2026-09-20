#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
browser="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
python3 -m http.server 8765 --bind 127.0.0.1 --directory web >/tmp/samt-http.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for n in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:8765/index.html >/dev/null; then break; fi
  sleep 1
done
"$browser" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --virtual-time-budget=3500 --window-size=412,915 \
  --screenshot="$PWD/ui-preview.png" http://127.0.0.1:8765/index.html >/dev/null 2>&1
"$browser" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --virtual-time-budget=3500 --window-size=412,915 \
  --dump-dom http://127.0.0.1:8765/index.html > "$PWD/ui-dom.html" 2>/dev/null
grep -q '<h1>Today</h1>' ui-dom.html
grep -q 'Your bearing today' ui-dom.html
echo 'PASS: SAMT interface rendered in a mobile browser'
