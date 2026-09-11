#!/usr/bin/env bash
# Separate Linux runner dependencies from the Windows workspace node_modules.
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
[[ "$(uname -s)" == Linux ]] || { echo 'Run this script inside WSL/Linux.' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])!==24)throw Error("Node 24 required")'
runner_root="$project_root/.local/linux-test-tools"
if [[ "${1:-}" == --setup ]]; then
  shift
  mkdir -p "$runner_root"
  node --input-type=module - "$runner_root" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const p=JSON.parse(readFileSync('package.json','utf8'));
writeFileSync(process.argv[2]+'/package.json',JSON.stringify({private:true,type:'module',dependencies:{vitest:p.devDependencies.vitest,typescript:p.dependencies.typescript}}));
JS
  npm --prefix "$runner_root" install --ignore-scripts --no-audit --no-fund
fi
[[ -f "$runner_root/node_modules/vitest/vitest.mjs" ]] || { echo 'Missing Linux runner. Run: bash scripts/test-wsl.sh --setup [test paths]' >&2; exit 1; }
export CODING_AGENT_BWRAP_PATH="${CODING_AGENT_BWRAP_PATH:-$(command -v bwrap || true)}"
if [[ -z "$CODING_AGENT_BWRAP_PATH" && -x "$project_root/.local/toolchains/bwrap/usr/bin/bwrap" ]]; then
  export CODING_AGENT_BWRAP_PATH="$project_root/.local/toolchains/bwrap/usr/bin/bwrap"
fi
[[ -x "$CODING_AGENT_BWRAP_PATH" ]] || { echo 'Set CODING_AGENT_BWRAP_PATH to the installed bubblewrap executable; no tests started.' >&2; exit 1; }
[[ -f vendor/coding-agent/dist/app/cli/main.js ]] || { echo 'Build vendor/coding-agent before running kernel tests.' >&2; exit 1; }
node --input-type=module <<'JS'
import { WorkspaceSandbox, ProcessSandbox } from './vendor/coding-agent/dist/public-api.js';
const ws=await WorkspaceSandbox.create(process.cwd());
const profile=await ProcessSandbox.probe(process.cwd(),ws);
if(!profile.available)throw Error('Process sandbox preflight failed; check bubblewrap on this host');
JS
# No import from the workspace's Windows-installed Vitest/config package.
# testTimeout: the Linux runner has no default budget of its own, and the heavy
# suites (real SQLite ledger, real application host, real kernel) take 1-3s each.
# Vitest's 5s default produced false failures that moved between files on every
# full-repo run while each file passed alone. Give every test an explicit budget
# instead of tuning individual cases.
node --input-type=module - "$runner_root" "$project_root" <<'JS'
import {writeFileSync} from 'node:fs';
writeFileSync(process.argv[2]+'/vitest.config.mjs','export default '+JSON.stringify({root:process.argv[3],test:{environment:'node',include:['tests/**/*.test.ts'],clearMocks:true,restoreMocks:true,testTimeout:30000}}));
JS
exec node "$runner_root/node_modules/vitest/vitest.mjs" run --config "$runner_root/vitest.config.mjs" "$@"
