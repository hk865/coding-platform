#!/usr/bin/env bash
set -eu
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-02
OLD=evidence/collaboration-memory/CM-1C-001/implementation/continuation-01/browser-service
cp -a "$OLD" "$OUT/pre-repair-browser-reference"
export C1_SERVICE_BROWSER=1
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
set +e
bash scripts/test-wsl.sh tests/app/architecture-review-service.test.ts --maxWorkers=2 > "$OUT/logs/browser-service.log" 2>&1
status=$?
set -e
cp -a "$OLD" "$OUT/browser-service"
cp -a "$OUT/pre-repair-browser-reference/." "$OLD/"
printf 'browser=%s\n' "$status" > "$OUT/logs/browser-results.txt"
exit "$status"
