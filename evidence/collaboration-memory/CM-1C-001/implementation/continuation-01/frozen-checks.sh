#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/logs/types.log" 2>&1
types=$?
pnpm --dir src/ui typecheck > "$OUT/logs/ui-types.log" 2>&1
ui=$?
node scripts/check-module-boundaries.mjs > "$OUT/logs/boundaries.json"
boundaries=$?
pnpm build > "$OUT/logs/build.log" 2>&1
build=$?
bash scripts/test-wsl.sh --maxWorkers=4 > "$OUT/logs/full-regression.log" 2>&1
tests=$?
node scripts/source-snapshot.mjs --out "$OUT/source-snapshot-after.json"
printf 'types=%s ui=%s boundaries=%s build=%s tests=%s\n' "$types" "$ui" "$boundaries" "$build" "$tests" > "$OUT/logs/results.txt"
exit $((types+ui+boundaries+build+tests))
