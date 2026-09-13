#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1B-001/implementation/continuation-01
bash scripts/test-wsl.sh tests/memory tests/coordination/host-tool-chain.test.ts tests/context/work-run-materials.test.ts tests/app/semantic-query.test.ts tests/contracts/module-ownership.test.ts tests/control/work-record.test.ts --maxWorkers=4 > "$OUT/targeted-06.log" 2>&1
rc=$?
tail -n 30 "$OUT/targeted-06.log"
exit "$rc"