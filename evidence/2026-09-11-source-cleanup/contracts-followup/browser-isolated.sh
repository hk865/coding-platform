#!/usr/bin/env bash
set -uo pipefail
cd /mnt/d/1.project/Software/agent_platform
export PATH="$PWD/.local/def17-bin:/home/han001/.local/bin:$PATH"
export CODING_AGENT_BWRAP_PATH="$PWD/.local/toolchains/bwrap/usr/bin/bwrap"
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
evidence=evidence/2026-09-11-source-cleanup/contracts-followup
export SEMANTIC_EVIDENCE_DIR="$evidence"
export FIXTURE_DIR="$PWD/.local/contracts-followup-browser-20260911/root"
export FIXTURE_DATA="$PWD/.local/contracts-followup-browser-20260911/data"
# The original server resets its fixture paths. Only permit these fresh,
# explicitly bounded paths, never an existing workspace or test history.
[[ ! -e "$PWD/.local/contracts-followup-browser-20260911" ]] || { echo 'Fixture directory already exists'; exit 2; }
[[ ! -e "$evidence/browser-isolated.log" ]] || exit 2
node src/ui/node_modules/@playwright/test/cli.js test --config "$evidence/playwright.config.ts" --output="$evidence/browser-results-isolated" > "$evidence/browser-isolated.log" 2>&1
result=$?
echo "$result" > "$evidence/browser-isolated.exit"
tail -22 "$evidence/browser-isolated.log"
exit "$result"
