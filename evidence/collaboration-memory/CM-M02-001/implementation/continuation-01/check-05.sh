#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-M02-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-05.log" 2>&1
types=$?
pnpm --dir src/ui typecheck > "$OUT/ui-types-05.log" 2>&1
ui=$?
bash scripts/test-wsl.sh tests/integration/query-result-recovery.test.ts tests/integration/p1-09-query-regression.test.ts tests/app/semantic-query.test.ts tests/memory/query-input.test.ts tests/context/query-execution-context.test.ts --maxWorkers=4 > "$OUT/targeted-05.log" 2>&1
tests=$?
printf 'types=%s ui=%s tests=%s\n' "$types" "$ui" "$tests" > "$OUT/results-05.txt"
exit $((types+ui+tests))
