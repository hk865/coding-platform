#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-M06-001/implementation/CMM06-001-snap-01/logs
bash scripts/test-wsl.sh --maxWorkers=4 > "$OUT/full-regression.log" 2>&1
result=$?
printf '%s\n' "$result" > "$OUT/full-regression.exit-code"
tail -n 14 "$OUT/full-regression.log"
exit "$result"
