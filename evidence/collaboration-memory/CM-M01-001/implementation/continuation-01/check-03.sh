#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-M01-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-03.log" 2>&1
types=$?
bash scripts/test-wsl.sh tests/control/scoped-dispatch.test.ts tests/control/reviewer-existing-drivers-isolation.test.ts --maxWorkers=4 > "$OUT/targeted-03.log" 2>&1
tests=$?
printf 'types=%s tests=%s\n' "$types" "$tests" > "$OUT/results-03.txt"
exit $((types+tests))
