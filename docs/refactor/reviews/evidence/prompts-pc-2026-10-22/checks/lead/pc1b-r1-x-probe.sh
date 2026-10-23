#!/bin/bash
# Lead probe of audit 2's part X fix (2026-10-22 night): in the lead's clone only (1b5183a, S-01 strict), give the
# scenario Work double the Host's model identity (Codex X.out.md §3: `ag2bWorkRuntime` gains an optional `workModelId`
# that fills `selection`; `openWorkRoot` and `openReviewWorkRoot` pass the id the Host computes from the AG2b startup
# binding), then run every test file that reaches those roots, with bubblewrap, batches of 10, then restore.
set -u
D=/home/han001/dsh-work/slices/s9pc1b-full
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
cd $D || exit 1
test "$(git rev-parse --short HEAD)" = 1b5183a || { echo "clone HEAD is not 1b5183a"; exit 2; }
H=tests/scenarios/harness.ts; C=tests/scenarios/support/common.ts; RW=tests/scenarios/support/review-work-root.ts
test -z "$(git status --porcelain -- $H $C $RW)" || { echo "helpers not clean"; exit 2; }
ID="runtimeModelId({ provider: 'deepseek', model: 'ag2b-scripted-work', secretEnvironmentVariable: AG2B_SECRET_VAR })"
perl -0pi -e 's/(options: \{ tools\?: readonly string\[\]; queryModel\?: ScriptedModel)( \} = \{\}\): RuntimeHostBindings \{)/$1; workModelId?: string$2/' $H
perl -0pi -e "s/(baseUrl: 'http:\/\/127.0.0.1' \}, client: model\(\).client,)/\$1\n          ...(options.workModelId === undefined ? {} : {\n            selection: { modelId: options.workModelId, promptPack: 'platform', reasoningReplay: 'current_run' as const } }),/" $H
perl -0pi -e 's/(AG2B_RESULT_TEXT, AG2B_SCOPE, )(AG2B_WORK_ROLE,)/$1AG2B_SECRET_VAR, $2/' $C
perl -0pi -e "s/(import \{ createWorkbenchServer, type WorkbenchServer \} from '..\/..\/..\/src\/app\/server.js';)/\$1\nimport { runtimeModelId } from '..\/..\/..\/src\/app\/runtime-configuration.js';/" $C
perl -0pi -e "s/(export async function openWorkRoot\(.*?runtime: ag2bWorkRuntime\(\(\) => model, \{ )/\$1workModelId: $ID, /s" $C
perl -0pi -e 's/(AG2B_AT, AG2B_CONSUMER_ID, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, )(AG2B_WORK_ROLE,)/$1AG2B_SECRET_VAR, $2/' $RW
perl -0pi -e 's/(createWorkbenchRuntimeHostBindings, )(type WorkbenchRuntimeConfiguration,)/$1runtimeModelId, $2/' $RW
perl -0pi -e "s/(ag2bWorkRuntime\(\(\) => model, \{ tools: \[\.\.\.AG2B_WORK_TOOLS, 'run_readonly_command'\])( \}\);)/\$1, workModelId: $ID\$2/" $RW
git diff --stat -- $H $C $RW | cat
git diff -- $H $C $RW | grep -cE "^\+.*(workModelId|AG2B_SECRET_VAR|runtimeModelId)"
FILES=$(grep -rlE "openWorkRoot|openReviewWorkRoot|authorizeWithoutBegin|crashOneCommand|proposalRound|review-card-round|shell-work-root|review-work-root|support/brief|support/fuzz" tests --include=*.test.ts | sort)
echo "files: $(echo $FILES | wc -w)"
set -- $FILES
while [ $# -gt 0 ]; do
  batch="${@:1:10}"; shift $(( $# < 10 ? $# : 10 ))
  echo "batch started $(date +%H:%M)"
  systemd-run --user --scope -q --unit=pc-xprobe-$RANDOM -p MemoryMax=7G timeout 1500 npx vitest run --maxWorkers=4 $batch 2>&1 \
    | sed -r 's/\x1b\[[0-9;]*m//g' | grep -E "Test Files|Tests |^ FAIL|Error:" | head -20
done
git checkout -q -- $H $C $RW
echo "restored: $(git status --porcelain -- $H $C $RW | wc -l) changed"
date +%H:%M
