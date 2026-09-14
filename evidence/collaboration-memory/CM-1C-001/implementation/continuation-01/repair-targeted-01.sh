#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1C-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/repair-types-01.log" 2>&1
bash scripts/test-wsl.sh tests/app/explorations.test.ts tests/app/exploration-runtime.test.ts tests/control/reviewer-runtime-start-rejection.test.ts tests/coordination/coordination-capability.test.ts tests/coordination/architecture-review-host.test.ts tests/app/architecture-review-service.test.ts --maxWorkers=4 > "$OUT/repair-targeted-01.log" 2>&1
