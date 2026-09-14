#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1C-001/implementation/continuation-01
node "$OUT/format-new-files.mjs"
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > "$OUT/types-13.log" 2>&1
pnpm --dir src/ui typecheck > "$OUT/ui-types-04.log" 2>&1
node scripts/check-module-boundaries.mjs > "$OUT/boundary-03.json"
cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform
node dev_docs/verification/validate-docs.mjs > /mnt/d/1.project/Software/agent_platform/$OUT/docs-02.log 2>&1
