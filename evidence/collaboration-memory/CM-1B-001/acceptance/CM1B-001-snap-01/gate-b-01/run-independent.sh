#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1B-001/acceptance/CM1B-001-snap-01/gate-b-01
bash scripts/test-wsl.sh tests/memory/maintenance.test.ts tests/memory/context.test.ts tests/memory/host.test.ts tests/memory/query-input.test.ts --maxWorkers=2 > "$OUT/independent-memory.log" 2>&1
memory_rc=$?
printf '%s\n' "$memory_rc" > "$OUT/memory.rc"
bash scripts/test-wsl.sh tests/coordination/host-tool-chain.test.ts -t memory=true --maxWorkers=2 > "$OUT/independent-same-task.log" 2>&1
same_rc=$?
printf '%s\n' "$same_rc" > "$OUT/same-task.rc"
test "$memory_rc" -eq 0 && test "$same_rc" -eq 0