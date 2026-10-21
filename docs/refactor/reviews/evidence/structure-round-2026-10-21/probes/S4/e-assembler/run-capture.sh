#!/usr/bin/env bash
# S4/D3b copy-only capture driver. Never run against the repository tree.
# Usage: run-capture.sh <copy-root> <output-jsonl-dir> <log-file>
# Every command is at most 10 files, `npx vitest run --maxWorkers=2`, `timeout 900`.
set -euo pipefail
root=$(realpath "${1:?copy root}")
out=$(realpath -m "${2:?output dir}")
log=$(realpath -m "${3:?log file}")
rm -rf "$out"
mkdir -p "$out" "$(dirname "$log")"
cd "$root"
: > "$log"
# Determinism (book §5.0 rule 3): the test fixtures' real `git commit` hashes
# otherwise depend on the wall clock. The same environment is exported for both
# copies; no test file is edited.
export GIT_AUTHOR_NAME='S85 probe'
export GIT_AUTHOR_EMAIL='s85-probe@example.invalid'
export GIT_COMMITTER_NAME='S85 probe'
export GIT_COMMITTER_EMAIL='s85-probe@example.invalid'
export GIT_AUTHOR_DATE='2026-01-01T00:00:00 +0000'
export GIT_COMMITTER_DATE='2026-01-01T00:00:00 +0000'
statuses=()
run() {
  echo "=== $* ===" | tee -a "$log"
  set +e
  S85_PROBE_DIR="$out" timeout 900 npx vitest run --maxWorkers=2 "$@" > "$log.part" 2>&1
  status=$?
  set -e
  cat "$log.part" | tee -a "$log"
  rm -f "$log.part"
  echo "status=$status" | tee -a "$log"
  statuses+=("$status")
}
# A: the five assembler-calling files (result probe item 1).
run tests/runtime/S3-context-assembler.test.ts \
    tests/runtime/S4C2-assembly.test.ts \
    tests/work-graph/S3-role-profiles.test.ts \
    tests/runtime/WP1-context-assembly.test.ts \
    tests/scenarios/S3-context-and-inputs.test.ts
# B: the remaining s85-tests.txt files, first nine.
run tests/app/S3-attention-context.test.ts \
    tests/business/S1-archive-flow.test.ts \
    tests/contracts/A2-rework-contract-helpers.test.ts \
    tests/runtime/K3-16-proposal-input.test.ts \
    tests/runtime/K3-16-review-extremes-pure.test.ts \
    tests/runtime/K3-35-manifest-trim-pure.test.ts \
    tests/runtime/K3-35-workspace-baseline-prepare.test.ts \
    tests/runtime/K3-B3-cancellation-cancelled.test.ts \
    tests/runtime/K3-B3-runtime-fail-closed.test.ts
# C: ten more.
run tests/runtime/K3-merge-cancel-propagation.test.ts \
    tests/runtime/K3-review-input-pure.test.ts \
    tests/runtime/K3-review-preparation.test.ts \
    tests/runtime/K3-unknown-call-review-section.test.ts \
    tests/runtime/S1-archive-files-brief.test.ts \
    tests/scenarios/S3-query-graph.test.ts \
    tests/work-graph/K3-35-owner-manifest-trim.test.ts \
    tests/work-graph/R5b-initial-plan.test.ts \
    tests/work-graph/S4C2-memory-material.test.ts \
    tests/work-graph/S4C2-project-set-shared.test.ts
# D: the last one.
run tests/work-graph/S4C2-read-counts.test.ts
echo "capture complete: $out (statuses: ${statuses[*]})" | tee -a "$log"
