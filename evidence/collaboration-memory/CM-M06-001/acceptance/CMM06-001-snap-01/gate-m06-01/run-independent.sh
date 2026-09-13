#!/usr/bin/env bash
set -u
cd /mnt/d/1.project/Software/agent_platform
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
OUT=evidence/collaboration-memory/CM-M06-001/acceptance/CMM06-001-snap-01/gate-m06-01
node --import ./tests/coordination/process-loader.mjs "$OUT/real-source-witness.mjs" > "$OUT/real-source-witness.log" 2>&1
witness_rc=$?
printf '%s\n' "$witness_rc" > "$OUT/witness.rc"
bash scripts/test-wsl.sh tests/coordination/alternative-report-hosts.test.ts tests/coordination/communication-view.test.ts tests/coordination/report-observation.test.ts --maxWorkers=2 > "$OUT/independent-targeted.log" 2>&1
target_rc=$?
printf '%s\n' "$target_rc" > "$OUT/targeted.rc"
exit "$target_rc"