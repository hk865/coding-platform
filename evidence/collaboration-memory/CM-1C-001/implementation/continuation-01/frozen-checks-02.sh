#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-02
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/logs/types.log" 2>&1
types=$?
pnpm --dir src/ui typecheck > "$OUT/logs/ui-types.log" 2>&1
ui=$?
node scripts/check-module-boundaries.mjs > "$OUT/logs/boundaries.json"
boundaries=$?
pnpm build > "$OUT/logs/build.log" 2>&1
build=$?
bash scripts/test-wsl.sh tests/app/explorations.test.ts tests/app/exploration-runtime.test.ts tests/control/reviewer-runtime-start-rejection.test.ts tests/app/independent-review.test.ts tests/app/real-runtime.test.ts tests/app/semantic-query.test.ts tests/coordination/coordination-capability.test.ts tests/coordination/host-tool-chain.test.ts tests/coordination/architecture-review-host.test.ts tests/app/architecture-review-service.test.ts tests/control/architecture-review.test.ts --maxWorkers=4 > "$OUT/logs/affected-regression.log" 2>&1
tests=$?
(cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform && node dev_docs/verification/validate-docs.mjs) > "$OUT/logs/docs.log" 2>&1
docs=$?
node scripts/source-snapshot.mjs --out "$OUT/source-snapshot-after.json"
printf 'types=%s ui=%s boundaries=%s build=%s tests=%s docs=%s\n' "$types" "$ui" "$boundaries" "$build" "$tests" "$docs" > "$OUT/logs/results.txt"
exit $((types+ui+boundaries+build+tests+docs))
