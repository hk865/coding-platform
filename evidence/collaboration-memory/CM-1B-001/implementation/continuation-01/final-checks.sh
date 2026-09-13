#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1B-001/implementation/CM1B-001-snap-01/logs
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types.log" 2>&1
types=$?
node scripts/check-module-boundaries.mjs > "$OUT/boundaries.json" 2>&1
boundaries=$?
pnpm --dir src/ui typecheck > "$OUT/ui-types.log" 2>&1
ui=$?
pnpm build > "$OUT/build.log" 2>&1
build=$?
printf 'types=%s boundaries=%s ui=%s build=%s\n' "$types" "$boundaries" "$ui" "$build" > "$OUT/checks.exit-codes"
cat "$OUT/checks.exit-codes"
test "$types" -eq 0 && test "$boundaries" -eq 0 && test "$ui" -eq 0 && test "$build" -eq 0
