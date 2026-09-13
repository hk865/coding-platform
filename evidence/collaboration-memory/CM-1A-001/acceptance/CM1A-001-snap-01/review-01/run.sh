#!/usr/bin/env bash
set -u
export PATH="/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH"
OUT=evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-01/review-01
mkdir -p "$OUT/logs"
run() {
  local name="$1"; shift
  printf '%s cwd=%s command=' "$(date -Is)" "$PWD" >> "$OUT/commands.log"
  printf '%q ' "$@" >> "$OUT/commands.log"
  printf '\n' >> "$OUT/commands.log"
  "$@" > "$OUT/logs/$name.log" 2>&1
  local result=$?
  printf '%s exit=%s\n' "$name" "$result" | tee -a "$OUT/commands.log"
}
run environment bash -c 'node --version; npm --version; pnpm --version; uname -a'
run build pnpm build
run typecheck pnpm typecheck
run boundaries pnpm check:architecture
run coordination bash scripts/test-wsl.sh tests/coordination tests/contracts/module-ownership.test.ts
run full-tests bash scripts/test-wsl.sh
run ui-typecheck pnpm ui:typecheck
run docs node ../agent_learn/agent_dev/agent_platform/dev_docs/verification/validate-docs.mjs
