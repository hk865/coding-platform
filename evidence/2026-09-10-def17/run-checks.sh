#!/usr/bin/env bash
set -euo pipefail
cd /mnt/d/1.project/Software/agent_platform
evidence_dir="$PWD/evidence/2026-09-10-def17"
export CODING_AGENT_BWRAP_PATH="$PWD/.local/toolchains/bwrap/usr/bin/bwrap"
export CHROME_PATH=/home/han001/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
# WSL has pnpm but no npm. This local shim forwards only run-script operations
# required by the repository's unchanged build and browser commands.
mkdir -p .local/def17-bin
cat > .local/def17-bin/npm <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --prefix ]]; then
  directory="$2"; shift 2
  exec pnpm --dir "$directory" "$@"
fi
exec pnpm "$@"
SH
chmod +x .local/def17-bin/npm
export PATH="$PWD/.local/def17-bin:$PWD/.local/linux-test-tools/node_modules/.bin:$PATH"
run_check() {
  local name="$1"; shift
  printf '%s\n' "COMMAND: $*" > "$evidence_dir/$name.log"
  set +e
  "$@" >> "$evidence_dir/$name.log" 2>&1
  local code=$?
  set -e
  printf '\nEXIT_CODE=%s\n' "$code" >> "$evidence_dir/$name.log"
  echo "$name exit=$code"
  return "$code"
}
case "${1:-}" in
  build) run_check build pnpm run build ;;
  types) run_check backend-types node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit
         run_check ui-types pnpm --dir src/ui exec tsc -p tsconfig.json --noEmit ;;
  browser-targeted) run_check browser-targeted pnpm --dir src/ui exec playwright test --config tests/playwright.config.ts reviewer-recovery.spec.ts ;;
  browser) run_check browser-final pnpm run ui:test ;;
  full) run_check full-tests-final bash scripts/test-wsl.sh --maxWorkers=2 ;;
  boundaries) run_check module-boundaries node scripts/check-module-boundaries.mjs ;;
  *) echo 'Expected build|types|browser-targeted|browser|full|boundaries' >&2; exit 2 ;;
esac
