#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1B-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-03.log" 2>&1
core=$?
pnpm --dir src/ui typecheck > "$OUT/ui-types-01.log" 2>&1
ui=$?
node scripts/check-module-boundaries.mjs > "$OUT/boundaries-01.log" 2>&1
boundary=$?
printf 'core=%s ui=%s boundary=%s\n' "$core" "$ui" "$boundary"
tail -n 15 "$OUT/types-03.log"
tail -n 15 "$OUT/ui-types-01.log"
exit "$((core+ui+boundary))"