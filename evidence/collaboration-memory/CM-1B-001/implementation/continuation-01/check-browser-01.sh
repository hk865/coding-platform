#!/usr/bin/env bash
set -u
cd /mnt/d/1.project/Software/agent_platform
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
OUT=evidence/collaboration-memory/CM-1B-001/implementation/continuation-01
export GUI_TEST_PORT=4497
export MEMORY_MODEL_STUB=1
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
export FIXTURE_DIR=.local/cm-1b-ui-fixture
export FIXTURE_DATA=.local/cm-1b-ui-data
pnpm --dir src/ui exec playwright test --config tests/playwright.config.ts memory.spec.ts > "$OUT/browser-01.log" 2>&1
result=$?
tail -n 30 "$OUT/browser-01.log"
exit "$result"