#!/usr/bin/env bash
set -u
cd /mnt/d/1.project/Software/agent_platform
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
OUT=evidence/collaboration-memory/CM-M06-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-07.log" 2>&1
types_rc=$?
node scripts/check-module-boundaries.mjs > "$OUT/boundaries-05.json" 2>&1
boundary_rc=$?
pnpm --dir src/ui typecheck > "$OUT/ui-types-05.log" 2>&1
ui_rc=$?
printf 'types=%s boundaries=%s ui=%s\n' "$types_rc" "$boundary_rc" "$ui_rc" > "$OUT/check-exit-codes-05.txt"
cat "$OUT/check-exit-codes-05.txt"
test "$types_rc" -eq 0 && test "$boundary_rc" -eq 0 && test "$ui_rc" -eq 0
