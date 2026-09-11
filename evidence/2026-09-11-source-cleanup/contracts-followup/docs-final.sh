#!/usr/bin/env bash
set -uo pipefail
evidence=/mnt/d/1.project/Software/agent_platform/evidence/2026-09-11-source-cleanup/contracts-followup
[[ ! -e "$evidence/docs-final.log" ]] || exit 2
cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform
/home/han001/.local/bin/node dev_docs/verification/validate-docs.mjs > "$evidence/docs-final.log" 2>&1
result=$?
echo "$result" > "$evidence/docs-final.exit"
cat "$evidence/docs-final.log"
exit "$result"
