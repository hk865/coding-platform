#!/usr/bin/env bash
set -u
cd /mnt/d/1.project/Software/agent_platform
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
OUT=evidence/collaboration-memory/CM-M06-001/implementation/continuation-01
bash scripts/test-wsl.sh tests/coordination/route-drive.test.ts tests/coordination/host-tool-chain.test.ts --maxWorkers=4 > "$OUT/qualification-01.log" 2>&1
result=$?
tail -n 18 "$OUT/qualification-01.log"
exit "$result"