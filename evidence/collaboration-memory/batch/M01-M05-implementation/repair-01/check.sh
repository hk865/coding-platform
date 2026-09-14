#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
out=evidence/collaboration-memory/batch/M01-M05-implementation/repair-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$out/types-03.log" 2>&1
echo TYPES:$?
bash scripts/test-wsl.sh tests/app/handoff-recovery.test.ts tests/control/dispatch-same-local-identity.test.ts tests/app/rework-dispatch.test.ts tests/control/operator-cancellation.test.ts --maxWorkers=4 > "$out/targeted-02.log" 2>&1
echo TESTS:$?

