#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
out=evidence/collaboration-memory/batch/M01-M05-implementation/repair-02
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$out/types.log" 2>&1
echo TYPES:$?
bash scripts/test-wsl.sh tests/app/server-shutdown.test.ts tests/control/p1-15-role-rework-loop.test.ts tests/control/reviewer-existing-drivers-isolation.test.ts tests/app/handoff-recovery.test.ts tests/app/semantic-query.test.ts tests/app/rework-dispatch.test.ts --maxWorkers=4 > "$out/targeted.log" 2>&1
echo TESTS:$?
pnpm build > "$out/build.log" 2>&1
echo BUILD:$?