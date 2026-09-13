#!/usr/bin/env bash
export PATH="/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH"
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-01/review-01
printf '%s\n' 'bash <OUT>/spec-test-wsl.sh <OUT>/handover-successor.test.ts -t "Delivery 正文"' >> "$OUT/spec-commands.log"
bash "$OUT/spec-test-wsl.sh" "$OUT/handover-successor.test.ts" -t 'Delivery 正文' > "$OUT/logs/handover-successor.log" 2>&1
result=$?
echo "handover-successor exit=$result" | tee -a "$OUT/spec-commands.log"
exit "$result"
