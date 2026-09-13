#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1B-001/implementation/CM1B-001-snap-01/logs
while [[ ! -f "$OUT/full-regression.exit-code" ]]; do sleep 2; done
date -u +%FT%TZ > "$OUT/final-checks-started-at.txt"
bash evidence/collaboration-memory/CM-1B-001/implementation/continuation-01/final-checks.sh
checks=$?
node scripts/source-snapshot.mjs --out "$OUT/source-after.json" > "$OUT/source-after-output.log" 2>&1
source=$?
cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform
node dev_docs/verification/validate-docs.mjs > /mnt/d/1.project/Software/agent_platform/"$OUT"/documents.log 2>&1
docs=$?
printf 'checks=%s source=%s docs=%s\n' "$checks" "$source" "$docs"
exit "$((checks+source+docs))"
