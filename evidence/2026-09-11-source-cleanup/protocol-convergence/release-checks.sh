#!/usr/bin/env bash
set -uo pipefail
cd /mnt/d/1.project/Software/agent_platform
export PATH="$PWD/.local/def17-bin:/home/han001/.local/bin:$PATH"
export CODING_AGENT_BWRAP_PATH="$PWD/.local/toolchains/bwrap/usr/bin/bwrap"
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
evidence=evidence/2026-09-11-source-cleanup/protocol-convergence
export SEMANTIC_EVIDENCE_DIR="$evidence"
run() { local name="$1"; shift; [[ ! -e "$evidence/$name.log" ]] || return 2; "$@" > "$evidence/$name.log" 2>&1; local result=$?; echo "$result" > "$evidence/$name.exit"; tail -18 "$evidence/$name.log"; return "$result"; }
case "$1" in
 types) run backend-types-release node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit && run ui-types-release node src/ui/node_modules/typescript/bin/tsc --noEmit -p src/ui/tsconfig.json && run boundaries-release node scripts/check-module-boundaries.mjs --output="$evidence/boundaries.json" ;;
 targeted) run targeted-release bash scripts/test-wsl.sh tests/contracts tests/context/planning-context-compiler.test.ts tests/control/goal-change.test.ts tests/control/planning-interface.test.ts tests/control/rework-plan-compiler.test.ts tests/control/autonomous-rework.test.ts tests/control/rework-drive.test.ts tests/verification/verification-engine.test.ts tests/verification/rework-issues.test.ts tests/app/semantic-loop.test.ts tests/runtime/context-continuation-adapter.test.ts ;;
 full) run full-tests bash scripts/test-wsl.sh ;;
 build) run build pnpm build && run ui-artifacts node scripts/verify-ui-build.mjs ;;
 browser)
  export FIXTURE_DIR="$PWD/.local/protocol-convergence-browser-20260911/root"
  export FIXTURE_DATA="$PWD/.local/protocol-convergence-browser-20260911/data"
  [[ ! -e "$PWD/.local/protocol-convergence-browser-20260911" ]] || exit 2
  run browser node src/ui/node_modules/@playwright/test/cli.js test --config "$evidence/playwright.config.ts" --output="$evidence/browser-results" ;;
 docs) run docs bash -c 'cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform && node dev_docs/verification/validate-docs.mjs' ;;
 *) exit 2 ;;
esac
