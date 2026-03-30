#!/usr/bin/env bash

set -euo pipefail

PORT="${1:-4010}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_DIR="$ROOT_DIR/_site"
PID_FILE="$ROOT_DIR/.preview-server.pid"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to run the local preview server." >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if kill -0 "$EXISTING_PID" >/dev/null 2>&1; then
    :
  else
    rm -f "$PID_FILE"
  fi
fi

if [[ ! -f "$PID_FILE" ]]; then
  if command -v lsof >/dev/null 2>&1 && lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $PORT is already in use. Set PREVIEW_PORT to a different value or stop the existing server." >&2
    exit 1
  fi

  nohup python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$SITE_DIR" \
    >/tmp/michaelzg-local-preview.log 2>&1 < /dev/null &
  PREVIEW_PID=$!
  echo "$PREVIEW_PID" > "$PID_FILE"
fi

URL="http://127.0.0.1:$PORT/"

for _ in 1 2 3 4 5 6; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -fsS "$URL" >/dev/null 2>&1; then
  rm -f "$PID_FILE"
  echo "Failed to start local preview server on port $PORT." >&2
  exit 1
fi

if [[ -n "${BROWSER_OPEN_CMD:-}" ]]; then
  "$BROWSER_OPEN_CMD" "$URL"
elif command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  echo "Preview ready at $URL"
fi
