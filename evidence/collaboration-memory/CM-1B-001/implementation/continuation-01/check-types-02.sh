#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1B-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-02.log" 2>&1
rc=$?
tail -n 20 "$OUT/types-02.log"
exit "$rc"
