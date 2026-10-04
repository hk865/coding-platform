#!/usr/bin/env bash
# Task E screenshot baseline: build is NOT done here (run `npm run build` first).
#
#   bash capture.sh <label: before|after-split|after-sse> [runs, default 3]
#
# For each run: start run-host.mjs on a fresh temporary directory (fixed seed),
# capture with capture.mjs, stop the Host. Run 1 also records polling.json.
# Then compare run 1 with every later run pixel by pixel (compare.mjs) and copy
# run 1's PNGs, manifest, polling and the comparison into <label>/.
# capture.mjs gets the Host pid (phase 2: its fallback scenario breaks the open
# change stream with SIGUSR2). A trap stops the current Host on any exit.
#
# Environment: REPO_ROOT (default: five levels above this directory), PORT
# (default 44851; never 44797), PW_VERSION (default 1.63.0 = chromium 1243).
set -euo pipefail
EV=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=${REPO_ROOT:-$(cd "$EV/../../../../.." && pwd)}
LABEL=${1:-before}
RUNS=${2:-3}
PORT=${PORT:-44851}
PW_VERSION=${PW_VERSION:-1.63.0}
[ -f "$REPO_ROOT/dist/app/host.js" ] && [ -f "$REPO_ROOT/dist/app/public/workbench/main.js" ] \
  || { echo "missing dist: run npm run build in $REPO_ROOT first" >&2; exit 2; }
WORK=$(mktemp -d /tmp/ui-split-sse-XXXX)
PW_BIN=$(cd "$WORK" && npx -y -p "playwright@$PW_VERSION" -c 'command -v playwright')
PLAYWRIGHT_DIR=$(dirname "$(readlink -f "$PW_BIN")")
export PLAYWRIGHT_DIR REPO_ROOT
echo "work=$WORK playwright=$PLAYWRIGHT_DIR repo=$REPO_ROOT label=$LABEL runs=$RUNS port=$PORT"

HOST_PID=
stop_host() {
  if [ -n "$HOST_PID" ]; then kill "$HOST_PID" 2>/dev/null || true; wait "$HOST_PID" 2>/dev/null || true; HOST_PID=; fi
}
trap stop_host EXIT

run_once() {
  local index=$1 flags=$2 dir="$WORK/run-$1"
  mkdir -p "$dir/host"
  node "$EV/run-host.mjs" --dir "$dir/host" --port "$PORT" > "$dir/host.out" 2> "$dir/host.err" &
  HOST_PID=$!
  for _ in $(seq 1 240); do
    [ -f "$dir/host/state.json" ] && break
    kill -0 "$HOST_PID" 2>/dev/null || { echo "host $index exited early" >&2; cat "$dir/host.err" >&2; return 1; }
    sleep 0.5
  done
  [ -f "$dir/host/state.json" ] || { echo "host $index did not become ready" >&2; stop_host; return 1; }
  # shellcheck disable=SC2086
  node "$EV/capture.mjs" --state "$dir/host/state.json" --out "$dir/shots" --host-pid "$HOST_PID" $flags 2> "$dir/capture.err" \
    || { cat "$dir/capture.err" >&2; stop_host; return 1; }
  stop_host
  echo "run $index: $(ls "$dir/shots"/*.png | wc -l) screenshots"
}

run_once 1 "--polling"
for index in $(seq 2 "$RUNS"); do run_once "$index" ""; done

mkdir -p "$EV/$LABEL"
rm -f "$EV/$LABEL"/*.png
cp "$WORK/run-1/shots/"*.png "$EV/$LABEL/"
cp "$WORK/run-1/shots/manifest.json" "$EV/$LABEL/manifest.json"
cp "$WORK/run-1/shots/polling.json" "$EV/$LABEL/polling.json"
node -e 'const s=require(process.argv[1]);delete s.url;delete s.port;process.stdout.write(JSON.stringify(s,null,2)+"\n")' \
  "$WORK/run-1/host/state.json" > "$EV/$LABEL/seed-state.json"
# Tie the screenshots to the exact served bundle and source commit.
{
  echo "source (git log -2):"; git -C "$REPO_ROOT" log -2 --format="  %h %s" 2>/dev/null || echo "  unknown"
  (cd "$REPO_ROOT/dist/app/public/workbench" && sha256sum index.html main.js styles.css views.js)
} > "$EV/$LABEL/bundle-sha256.txt"
for index in $(seq 2 "$RUNS"); do
  (cd "$WORK" && node "$EV/compare.mjs" run-1/shots "run-$index/shots") > "$EV/$LABEL/determinism-run1-vs-run$index.json"
  node -e 'const r=require(process.argv[1]);console.log(JSON.stringify(r.summary))' "$EV/$LABEL/determinism-run1-vs-run$index.json"
done
echo "kept temporary runs in $WORK"
