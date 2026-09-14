#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/batch/M01-M05-implementation/CMM01-M05-snap-01
bash scripts/test-wsl.sh --maxWorkers=4 > "$OUT/full-regression.log" 2>&1
result=$?
printf 'full_regression=%s\n' "$result" > "$OUT/full-result.txt"
exit "$result"
