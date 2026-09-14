#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-M05-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-01.log" 2>&1
types=$?
pnpm --dir src/ui typecheck > "$OUT/ui-types-01.log" 2>&1
ui=$?
bash scripts/test-wsl.sh tests/app/durable-wake.test.ts tests/app/semantic-query.test.ts tests/control/handoff-drive.test.ts tests/integration/p1-06.integration.test.ts tests/restart/p1-06-restart.test.ts tests/control/reviewer-dispatch-isolation.test.ts tests/control/reviewer-runtime-start-rejection.test.ts tests/control/reviewer-lease-conflict-recovery.test.ts tests/coordination/runtime-concurrency.test.ts tests/control/scoped-dispatch.test.ts tests/control/runtime-dispatch.test.ts tests/contracts/module-ownership.test.ts --maxWorkers=4 > "$OUT/targeted-01.log" 2>&1
tests=$?
printf 'types=%s ui=%s tests=%s\n' "$types" "$ui" "$tests" > "$OUT/results-01.txt"
exit $((types+ui+tests))
