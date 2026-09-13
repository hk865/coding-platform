#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1B-001/implementation/continuation-01
bash scripts/test-wsl.sh tests/memory tests/contracts/module-ownership.test.ts --maxWorkers=4 > "$OUT/targeted-02.log" 2>&1
rc=$?
tail -n 35 "$OUT/targeted-02.log"
exit "$rc"