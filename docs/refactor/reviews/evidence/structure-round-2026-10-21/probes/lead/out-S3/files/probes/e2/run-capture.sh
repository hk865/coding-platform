#!/usr/bin/env bash
# Copy-only capture driver for S3/D3a byte proof. Never run against the repository.
# Usage: run-capture.sh <copy-root> <output-jsonl-dir> <log-file>
set -euo pipefail
root=$(realpath "${1:?copy root}")
out=$(realpath -m "${2:?output dir}")
log=$(realpath -m "${3:?log file}")
rm -rf "$out"
mkdir -p "$out" "$(dirname "$log")"
cd "$root"
: > "$log"
# The probe-only driver lives in probes/e2; place it in the scratch copy's test tree for this run.
mkdir -p "$root/tests/probe-e2"
cp "$(dirname "$0")/driver.test.ts" "$root/tests/probe-e2/driver.test.ts"
run() {
  echo "=== $* ===" | tee -a "$log"
  # A test file may fail only for the known environment reason (no bubblewrap); the
  # probe captures registration/model-client bytes before any command execution, so
  # keep going and record the status rather than losing the rest of the capture.
  set +e
  S85_PROBE_DIR="$out" timeout 900 npx vitest run --maxWorkers=2 "$@" > "$log.part" 2>&1
  status=$?
  set -e
  cat "$log.part" | tee -a "$log"
  rm -f "$log.part"
  echo "status=$status" | tee -a "$log"
}
# A: the tool-registration / Kernel-assembly files (6 files).
run tests/runtime/C2-runtime-platform-tools.test.ts \
    tests/runtime/S3-graph-tools.test.ts \
    tests/runtime/K-readonly-command.test.ts \
    tests/runtime/K3-14-record-unknown-call-review-tool.test.ts \
    tests/runtime/K3-16-proposal-tool.test.ts \
    tests/runtime/B1-kernel-assembly.test.ts
# B: the remaining tool files (5 files).
run tests/runtime/source-tool-lifecycle.test.ts \
    tests/app/exploration-tools.test.ts \
    tests/app/reviewer-source-tools.test.ts \
    tests/app/project-source-tool.test.ts \
    tests/runtime/C1-communication-tools.test.ts
# C: the initial-planning / Query files that reach the guide expression (6 files).
run tests/work-graph/R5b-initial-plan.test.ts \
    tests/work-graph/R5b-query-execution.test.ts \
    tests/work-graph/R5b-query-job.test.ts \
    tests/business/R5b-initial-planning-workflow.test.ts \
    tests/composition/R5b-query-job-platform.test.ts \
    tests/runtime/R5b-query-session-loop.test.ts
# D: probe-only driver for the registration cases no repository test reaches (1 file).
run tests/probe-e2/driver.test.ts
# E: further real initial_coordination callers (4 files).
run tests/app/R6-host.test.ts     tests/app/host-settings.test.ts     tests/work-graph/S3-prepared-context-admission.test.ts     tests/runtime/S3-context-assembler.test.ts
echo "capture complete: $out" | tee -a "$log"
