#!/usr/bin/env bash
set -uo pipefail
cd /mnt/d/1.project/Software/agent_platform
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
out=evidence/collaboration-memory/CM-1C-001/acceptance/CM1C-001-snap-01/gate-c-01
bash scripts/test-wsl.sh tests/control/architecture-inspection.test.ts tests/control/baseline-evolution.test.ts --maxWorkers=2 > "$out/baseline.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$out/baseline.exit-code"
exit "$rc"