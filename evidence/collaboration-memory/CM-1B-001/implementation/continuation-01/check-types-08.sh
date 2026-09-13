#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1B-001/implementation/continuation-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-08.log" 2>&1
core=$?
pnpm --dir src/ui typecheck > "$OUT/ui-types-06.log" 2>&1
ui=$?
node scripts/check-module-boundaries.mjs > "$OUT/boundaries-06.log" 2>&1
boundary=$?
printf 'core=%s ui=%s boundary=%s\n' "$core" "$ui" "$boundary"
tail -n 15 "$OUT/types-08.log"
tail -n 15 "$OUT/ui-types-06.log"
cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform
node dev_docs/verification/validate-docs.mjs > /mnt/d/1.project/Software/agent_platform/evidence/collaboration-memory/CM-1B-001/implementation/continuation-01/docs-02.log 2>&1
docs=$?
printf 'docs=%s\n' "$docs"
exit "$((core+ui+boundary+docs))"