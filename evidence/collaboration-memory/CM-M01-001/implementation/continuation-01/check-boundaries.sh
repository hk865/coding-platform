#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-M01-001/implementation/continuation-01
node scripts/check-module-boundaries.mjs > "$OUT/boundaries-08.json" 2>&1
boundary=$?
bash scripts/test-wsl.sh tests/contracts/module-ownership.test.ts --maxWorkers=2 > "$OUT/ownership-08.log" 2>&1
tests=$?
printf 'boundary=%s ownership=%s\n' "$boundary" "$tests" > "$OUT/boundary-results-08.txt"
exit $((boundary+tests))
