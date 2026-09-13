#!/usr/bin/env bash
export PATH="/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH"
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-01/review-01
printf '%s\n' 'bash <OUT>/spec-test-wsl.sh <OUT>/no-successor-prepare.test.ts -t "Delivery 正文" (isolated test-wsl.sh copy; unchanged sandbox preflight; evidence-only config/include)' >> "$OUT/spec-commands.log"
bash "$OUT/spec-test-wsl.sh" "$OUT/no-successor-prepare.test.ts" -t 'Delivery 正文' > "$OUT/logs/no-successor-prepare.log" 2>&1
result=$?
echo "no-successor-prepare exit=$result" | tee -a "$OUT/spec-commands.log"
exit "$result"
