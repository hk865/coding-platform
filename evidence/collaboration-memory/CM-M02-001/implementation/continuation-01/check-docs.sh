#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=/mnt/d/1.project/Software/agent_platform/evidence/collaboration-memory/CM-M02-001/implementation/continuation-01
node scripts/check-module-boundaries.mjs > "$OUT/boundaries-09.json"
boundaries=$?
cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform
node dev_docs/verification/validate-docs.mjs > "$OUT/docs-09.log" 2>&1
docs=$?
printf 'boundary=%s docs=%s\n' "$boundaries" "$docs" > "$OUT/docs-results-09.txt"
exit $((boundaries+docs))
