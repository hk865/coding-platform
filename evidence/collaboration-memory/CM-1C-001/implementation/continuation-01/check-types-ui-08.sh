#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1C-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-08.log" 2>&1
core=$?
pnpm --dir src/ui typecheck > "$OUT/ui-types-03.log" 2>&1
ui=$?
node scripts/check-module-boundaries.mjs > "$OUT/boundary-02.json"
boundary=$?
cat "$OUT/types-08.log" "$OUT/ui-types-03.log"
exit $((core+ui+boundary))