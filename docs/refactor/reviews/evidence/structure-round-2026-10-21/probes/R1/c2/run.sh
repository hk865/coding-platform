#!/usr/bin/env bash
# C2 byte proof: run the seven proof files in the base copy twice and in the
# result copy once, each with its own probe log, then compare raw bytes.
#
# Usage:
#   ./run.sh [RESULT_DIR] [--base-only]
#   C2_RESULT_DIR=/path/to/result ./run.sh
#
# RESULT_DIR defaults to <scratch>/result-c2. If it does not exist, the base
# rounds still run and compare; the result round is skipped (not a failure).
# Pass --base-only to do that explicitly. The probe must already be applied.
set -u
ROOT=/home/han001/dsh-work/slices/s9s85r1/.dsh-scratch/R1
OUT=$ROOT/probes/c2
BASE=${C2_BASE_DIR:-$ROOT/base}
RESULT_LABEL=${C2_RESULT_LABEL:-result-run1}
BASE_ONLY=0
RESULT_ARG=${1:-}
if [ "$RESULT_ARG" = "--base-only" ]; then
  BASE_ONLY=1
  RESULT_ARG=
fi
RESULT_DIR=${C2_RESULT_DIR:-${RESULT_ARG:-$ROOT/result-c2}}
FILES=(
  tests/work-graph/S2B-activity-read-faults.test.ts
  tests/work-graph/S2B-r2-27-moving-window.test.ts
  tests/work-graph/S2B-r2-keyed-cap.test.ts
  tests/work-graph/S2B-r2-r7-keyed-read-cap.test.ts
  tests/work-graph/S2B-33-task-timeline-pagination.test.ts
  tests/work-graph/S2B-r2-r4-bound-workspace.test.ts
  tests/app/S2B-35-activity-routes.test.ts
)
status=0

node "$OUT/make-deterministic.mjs" "$BASE"
if [ ! -f "$BASE/src/core/work-graph/views/c2-probe.ts" ]; then
  echo "ERROR: probe not applied to base copy $BASE" >&2
  exit 2
fi

run_one() {
  local copy_dir="$1" label="$2" file="$3"
  local stem
  stem=$(basename "$file" .test.ts)
  local dir="$OUT/logs/$label"
  mkdir -p "$dir"
  rm -f "$dir/$stem.log" "$dir/$stem.stdout"
  echo "=== $label $stem"
  ( cd "$copy_dir" && C2_PROBE_LOG="$dir/$stem.log" timeout 900 npx vitest run --maxWorkers=2 "$file" ) \
    > "$dir/$stem.stdout" 2>&1
  local rc=$?
  local lines=0
  if [ -f "$dir/$stem.log" ]; then lines=$(wc -l < "$dir/$stem.log"); fi
  if [ "$rc" -ne 0 ]; then
    echo "TEST-FAIL rc=$rc $label $stem"
    status=1
  fi
  echo "rc=$rc log-lines=$lines"
}

compare_one() {
  local left="$1" right="$2" required="$3" label="$4" stem="$5"
  shift 5
  echo "--- $stem ($label)"
  if ! node "$OUT/compare.mjs" --required-from "$required" "$@" "$left" "$right"; then
    echo "COMPARE-FAIL $label $stem"
    status=1
  fi
}

# Concatenate one round's per-file logs in the fixed FILES order. The combined
# log is what applies the global "all four loop-result tags captured" rule.
combine_logs() {
  local label="$1"
  local combined="$OUT/logs/$label/_combined.log"
  : > "$combined"
  local file stem
  for file in "${FILES[@]}"; do
    stem=$(basename "$file" .test.ts)
    cat "$OUT/logs/$label/$stem.log" >> "$combined"
  done
}

for file in "${FILES[@]}"; do run_one "$BASE" base-run1 "$file"; done
for file in "${FILES[@]}"; do run_one "$BASE" base-run2 "$file"; done

echo
echo "== base determinism (raw bytes, no sorting/canonicalisation) =="
for file in "${FILES[@]}"; do
  stem=$(basename "$file" .test.ts)
  compare_one "$OUT/logs/base-run1/$stem.log" "$OUT/logs/base-run2/$stem.log" \
    "$OUT/logs/base-run1/$stem.log" "base-run1=base-run2" "$stem"
done

echo
echo "== combined base determinism (global four loop-result rule) =="
combine_logs base-run1
combine_logs base-run2
compare_one "$OUT/logs/base-run1/_combined.log" "$OUT/logs/base-run2/_combined.log" \
  "$OUT/logs/base-run1/_combined.log" "combined base-run1=base-run2" "_combined" --require-loop-results

if [ "$BASE_ONLY" -eq 1 ]; then
  echo
  echo "== result round skipped (--base-only) =="
elif [ ! -d "$RESULT_DIR" ]; then
  echo
  echo "== result round skipped: directory not found: $RESULT_DIR =="
else
  if [ ! -f "$RESULT_DIR/src/core/work-graph/views/c2-probe.ts" ]; then
    echo "ERROR: probe not applied to result copy $RESULT_DIR" >&2
    status=1
  else
    node "$OUT/make-deterministic.mjs" "$RESULT_DIR"
    for file in "${FILES[@]}"; do run_one "$RESULT_DIR" "$RESULT_LABEL" "$file"; done
    echo
    echo "== base vs result (raw bytes, no sorting/canonicalisation) =="
    for file in "${FILES[@]}"; do
      stem=$(basename "$file" .test.ts)
      compare_one "$OUT/logs/base-run1/$stem.log" "$OUT/logs/$RESULT_LABEL/$stem.log" \
        "$OUT/logs/base-run1/$stem.log" "base-run1=$RESULT_LABEL" "$stem"
    done

    echo
    echo "== combined base vs result (global four loop-result rule) =="
    combine_logs "$RESULT_LABEL"
    compare_one "$OUT/logs/base-run1/_combined.log" "$OUT/logs/$RESULT_LABEL/_combined.log" \
      "$OUT/logs/base-run1/_combined.log" "combined base-run1=$RESULT_LABEL" "_combined" --require-loop-results
  fi
fi

echo
echo "== call counts per probe tag/kind (base-run1) =="
for file in "${FILES[@]}"; do
  stem=$(basename "$file" .test.ts)
  echo "--- $stem"
  if [ -f "$OUT/logs/base-run1/$stem.log" ]; then
    awk -F'\t' '{ count[$2 "/" $3] += 1 } END { for (key in count) printf "%6d %s\n", count[key], key }' \
      "$OUT/logs/base-run1/$stem.log"
  else
    echo "     0 (no log)"
  fi
done

exit "$status"
