#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-M02-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-02.log" 2>&1
types=$?
bash scripts/test-wsl.sh tests/integration/query-result-recovery.test.ts tests/integration/p1-09-query-regression.test.ts tests/app/semantic-query.test.ts tests/memory/query-input.test.ts tests/context/query-execution-context.test.ts --maxWorkers=4 > "$OUT/targeted-02.log" 2>&1
tests=$?
printf 'types=%s tests=%s\n' "$types" "$tests" > "$OUT/results-02.txt"
exit $((types+tests))
