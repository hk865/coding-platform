#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-M01-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-07.log" 2>&1
types=$?
pnpm --dir src/ui typecheck > "$OUT/ui-types-07.log" 2>&1
ui=$?
bash scripts/test-wsl.sh tests/control/rework-task-dispatch.test.ts tests/app/rework-dispatch.test.ts tests/app/dispatch-wake.test.ts tests/control/runtime-dispatch.test.ts tests/app/explorations.test.ts tests/app/architecture-review-service.test.ts tests/control/scoped-dispatch.test.ts --maxWorkers=4 > "$OUT/targeted-07.log" 2>&1
tests=$?
printf 'types=%s ui=%s tests=%s\n' "$types" "$ui" "$tests" > "$OUT/results-07.txt"
exit $((types+ui+tests))
