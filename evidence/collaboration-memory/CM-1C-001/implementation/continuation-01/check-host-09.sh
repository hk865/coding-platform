#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1C-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-09.log" 2>&1
bash scripts/test-wsl.sh tests/coordination/architecture-review-host.test.ts tests/control/architecture-review.test.ts tests/contracts/module-ownership.test.ts --maxWorkers=4 > "$OUT/host-09.log" 2>&1
