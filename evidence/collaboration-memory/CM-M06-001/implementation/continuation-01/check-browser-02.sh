#!/usr/bin/env bash
set -u
cd /mnt/d/1.project/Software/agent_platform
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
OUT=evidence/collaboration-memory/CM-M06-001/implementation/continuation-01
export GUI_TEST_PORT=4496
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
export FIXTURE_DIR=.local/cm-m06-ui-fixture
export FIXTURE_DATA=.local/cm-m06-ui-data
pnpm --dir src/ui exec playwright test --config tests/playwright.config.ts communication.spec.ts > "$OUT/browser-02.log" 2>&1
result=$?
tail -n 30 "$OUT/browser-02.log"
exit "$result"