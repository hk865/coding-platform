#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
out=evidence/collaboration-memory/batch/M01-M05-implementation/repair-01
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$out/types-02.log" 2>&1
echo TYPES:$?
pnpm --dir src/ui typecheck > "$out/ui-types.log" 2>&1
echo UI_TYPES:$?
node scripts/check-module-boundaries.mjs --output="$out/boundary.json" > "$out/boundary.log" 2>&1
echo BOUNDARY:$?
cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform
node dev_docs/verification/validate-docs.mjs > /mnt/d/1.project/Software/agent_platform/$out/docs.log 2>&1
echo DOCS:$?
