#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-M03-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-02.log" 2>&1
types=$?
bash scripts/test-wsl.sh tests/control/handoff-drive.test.ts tests/integration/p1-06.integration.test.ts tests/restart/p1-06-restart.test.ts tests/control/reviewer-dispatch-isolation.test.ts tests/control/reviewer-runtime-start-rejection.test.ts tests/control/reviewer-lease-conflict-recovery.test.ts tests/coordination/runtime-concurrency.test.ts tests/control/scoped-dispatch.test.ts tests/control/runtime-dispatch.test.ts tests/contracts/module-ownership.test.ts --maxWorkers=4 > "$OUT/targeted-02.log" 2>&1
tests=$?
printf 'types=%s tests=%s\n' "$types" "$tests" > "$OUT/results-02.txt"
exit $((types+tests))
