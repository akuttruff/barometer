#!/bin/sh
# Rebuild and restart the persistent instance (launchd: com.amie.barometer),
# the one Tailscale serves. `npm run dev` is unaffected. A restart loses
# nothing but the tick in progress, so there is no busy check.
set -e
cd "$(dirname "$0")/.."
PORT=8510
npm run build
launchctl kickstart -k "gui/$(id -u)/com.amie.barometer"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sfo /dev/null "http://127.0.0.1:$PORT/"; then echo "barometer: deployed"; exit 0; fi
  sleep 1
done
echo "barometer: restarted, but not answering on :$PORT -- see ~/Library/Logs/com.amie.barometer.log" >&2
exit 1
