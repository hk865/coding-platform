#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
out=evidence/collaboration-memory/batch/M01-M05-implementation/CMM01-M05-snap-03
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$out/types.log" 2>&1
echo TYPES:$?
node scripts/check-module-boundaries.mjs --output="$out/boundary.json" > "$out/boundary.log" 2>&1
echo BOUNDARY:$?
bash scripts/test-wsl.sh tests/app tests/control/p1-15-role-rework-loop.test.ts tests/control/reviewer-existing-drivers-isolation.test.ts --maxWorkers=4 > "$out/affected.log" 2>&1
result=$?
echo affected=$result > "$out/affected-result.txt"
exit $result