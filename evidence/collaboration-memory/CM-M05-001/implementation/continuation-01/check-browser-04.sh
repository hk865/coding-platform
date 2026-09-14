#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-M05-001/implementation/continuation-01
pnpm build > "$OUT/build-04.log" 2>&1
build=$?
export M02_SERVICE_BROWSER=1
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
bash scripts/test-wsl.sh tests/app/semantic-query.test.ts --maxWorkers=2 > "$OUT/browser-04.log" 2>&1
tests=$?
printf 'build=%s browser=%s\n' "$build" "$tests" > "$OUT/browser-results-04.txt"
exit $((build+tests))
