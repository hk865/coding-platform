#!/usr/bin/env bash
# C2 byte proof: run the seven proof files in base twice and in the result copy
# once, each with its own probe log, then compare bytes. Run from anywhere.
set -u
ROOT=/tmp/s85-scratch/S2
OUT=$ROOT/probes/c2
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

run_one() {
  local copy="$1" label="$2" file="$3"
  local stem
  stem=$(basename "$file" .test.ts)
  local dir="$OUT/logs/$label"
  mkdir -p "$dir"
  rm -f "$dir/$stem.log"
  echo "=== $label $stem"
  ( cd "$ROOT/$copy" && C2_PROBE_LOG="$dir/$stem.log" timeout 900 npx vitest run --maxWorkers=2 "$file" ) \
    > "$dir/$stem.stdout" 2>&1
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "TEST-FAIL rc=$rc $label $stem"
    status=1
  fi
  echo "rc=$rc log-lines=$(wc -l < "$dir/$stem.log" 2>/dev/null || echo 0)"
}

for file in "${FILES[@]}"; do run_one base base-run1 "$file"; done
for file in "${FILES[@]}"; do run_one base base-run2 "$file"; done
for file in "${FILES[@]}"; do run_one result-c2 result-run1 "$file"; done

echo
echo "== comparisons (raw bytes, no sorting/canonicalisation) =="
for file in "${FILES[@]}"; do
  stem=$(basename "$file" .test.ts)
  echo "--- $stem"
  node "$OUT/compare.mjs" "$OUT/logs/base-run1/$stem.log" "$OUT/logs/base-run2/$stem.log" \
    || { echo "NONDETERMINISTIC $stem"; status=1; }
  node "$OUT/compare.mjs" "$OUT/logs/base-run1/$stem.log" "$OUT/logs/result-run1/$stem.log" \
    || { echo "DIFF $stem"; status=1; }
done

echo
echo "== call counts per probe tag/kind (base-run1) =="
for file in "${FILES[@]}"; do
  stem=$(basename "$file" .test.ts)
  echo "--- $stem"
  awk -F'\t' '{ count[$2 "/" $3] += 1 } END { for (key in count) printf "%6d %s\n", count[key], key }' "$OUT/logs/base-run1/$stem.log"
done

exit "$status"
