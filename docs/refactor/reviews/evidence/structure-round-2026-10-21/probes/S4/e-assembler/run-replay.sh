#!/usr/bin/env bash
# S4/D3b replay driver. Runs on a copy and replays the base-run1 assembler
# arguments/deps outcomes through that copy. Never run against the repository.
# Usage: run-replay.sh <copy-root> <base-run1-dir> <out-dir> <log-file>
set -euo pipefail
root=$(realpath "${1:?copy root}")
base=$(realpath "${2:?base-run1 dir}")
out=$(realpath -m "${3:?out dir}")
log=$(realpath -m "${4:?log file}")
rm -rf "$out"
mkdir -p "$out" "$(dirname "$log")"
mkdir -p "$root/tests/probe-e4"
cp "$(dirname "$0")/replay.test.ts" "$root/tests/probe-e4/replay.test.ts"
cd "$root"
set +e
S85_PROBE_DIR="$out" S85_REPLAY_BASE="$base" timeout 900 npx vitest run --maxWorkers=2 tests/probe-e4/replay.test.ts > "$log" 2>&1
status=$?
set -e
cat "$log"
echo "status=$status"
exit "$status"
