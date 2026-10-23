#!/bin/bash
# Lead probe after the PC-1b-R1 full suite (2026-10-22 night): are the 16 failing files all S-01's? In the lead's clone
# only, put back the two `selection === undefined` early returns (the reverse of R1's hunks in execution-driver.ts and
# query-execution.ts), rerun the 16 files with bubblewrap in two batches, then restore the two files.
set -u
D=/home/han001/dsh-work/slices/s9pc1b-full
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
cd $D || exit 1
test "$(git rev-parse --short HEAD)" = 1b5183a || { echo "clone HEAD is not 1b5183a"; exit 2; }
F="src/core/agent-runtime/execution-driver.ts src/core/agent-runtime/query-execution.ts"
test -z "$(git status --porcelain -- $F)" || { echo "the two files are not clean"; exit 2; }
git diff c1c7af4 HEAD -- $F | git apply -R || { echo "reverse apply failed"; exit 2; }
git diff --stat -- $F | cat
B1="tests/scenarios/A8-host-restart-entry.test.ts tests/scenarios/A8-host-restart.test.ts tests/scenarios/C3-brief-idempotency.test.ts tests/scenarios/C7-defer-reactivate.test.ts tests/scenarios/K-R-attested-facts-source.test.ts tests/scenarios/K3-06-mixed-batch.test.ts tests/scenarios/K3-08-wait-reply.test.ts tests/state/invariants-fuzz.test.ts"
B2="tests/scenarios/K3-26-inventory-scenarios.test.ts tests/scenarios/K3-29-recovery-continuation.test.ts tests/scenarios/K3-R1-continuation-protection.test.ts tests/scenarios/K3-R1-file-change.test.ts tests/scenarios/K3-R1-restart-flows.test.ts tests/scenarios/K3-R1-second-cleanup.test.ts tests/scenarios/K3-R1-session-not-closable.test.ts tests/scenarios/K3-R1-workspace-capture.test.ts"
for set in "$B1" "$B2"; do
  echo "batch started $(date +%H:%M)"
  timeout 1500 npx vitest run --maxWorkers=2 $set 2>&1 | sed -r 's/\x1b\[[0-9;]*m//g' | grep -E "Test Files|Tests |^ FAIL" | head -30
done
git checkout -q -- $F
echo "restored: $(git status --porcelain -- $F | wc -l) changed"
date +%H:%M
