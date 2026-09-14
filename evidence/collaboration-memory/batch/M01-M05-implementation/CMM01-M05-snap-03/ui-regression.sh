#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
export GUI_TEST_PORT=4496
export CODING_AGENT_BWRAP_PATH=/mnt/d/1.project/Software/agent_platform/.local/toolchains/bwrap/usr/bin/bwrap
export FIXTURE_DIR=.local/m-series-ui-fixture-snap03
export FIXTURE_DATA=.local/m-series-ui-data-snap03
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/batch/M01-M05-implementation/CMM01-M05-snap-03
pnpm ui:test > "$OUT/ui-regression.log" 2>&1
result=$?
printf 'ui_regression=%s\n' "$result" > "$OUT/ui-result.txt"
exit "$result"

