#!/usr/bin/env bash
set -uo pipefail
cd /mnt/d/1.project/Software/agent_platform
export PATH="$PWD/.local/def17-bin:/home/han001/.local/bin:$PATH"
export CODING_AGENT_BWRAP_PATH="$PWD/.local/toolchains/bwrap/usr/bin/bwrap"
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
evidence=evidence/2026-09-11-semantic-completion
export SEMANTIC_EVIDENCE_DIR="$evidence"
run() {
  local name="$1"; shift
  "$@" > "$evidence/$name.log" 2>&1
  local result=$?
  echo "$result" > "$evidence/$name.exit"
  tail -18 "$evidence/$name.log"
  return "$result"
}
case "$1" in
 targeted) run targeted-2 bash scripts/test-wsl.sh tests/control/rework-plan-compiler.test.ts tests/control/rework-drive.test.ts tests/control/plan-impact-work-identity.test.ts tests/app/semantic-loop.test.ts tests/verification/semantic-reverification.test.ts tests/verification/verification-service.test.ts tests/verification/verification-rounds.test.ts tests/contracts/module-ownership.test.ts ;;
 types) run backend-types-2 node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit && run ui-types node src/ui/node_modules/typescript/bin/tsc --noEmit -p src/ui/tsconfig.json && run boundaries node scripts/check-module-boundaries.mjs --output="$evidence/boundaries.json" ;;
 full) run full-tests bash scripts/test-wsl.sh ;;
 full-final) run full-tests-final bash scripts/test-wsl.sh ;;
 types-final) run backend-types-final node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit && run ui-types-final node src/ui/node_modules/typescript/bin/tsc --noEmit -p src/ui/tsconfig.json && run boundaries-final node scripts/check-module-boundaries.mjs --output="$evidence/boundaries-final.json" ;;
 browser) run browser node src/ui/node_modules/@playwright/test/cli.js test --config src/ui/tests/playwright.config.ts --output="$evidence/browser-results" ;;
 build) run build pnpm build && run ui-artifacts node scripts/verify-ui-build.mjs ;;
 docs) cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform; node dev_docs/verification/validate-docs.mjs ;;
 *) exit 2 ;;
esac

