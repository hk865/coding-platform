#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1C-001/implementation/continuation-01
pnpm ui:build > "$OUT/ui-build-01.log" 2>&1 || exit $?
export C1_SERVICE_BROWSER=1
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
bash scripts/test-wsl.sh tests/app/architecture-review-service.test.ts --maxWorkers=2 > "$OUT/service-browser-01.log" 2>&1
