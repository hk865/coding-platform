#!/bin/bash
# The lead's re-run of S4's byte proofs (D3b) on fresh copies, with S4's own probe kits (s9s85-S4/.dsh-scratch/S4/
# probes: e-assembler = the whole assembler result, bodies.put, the deps proxy with the clock; e-render = record and
# replay of the renderers and fact formatters, the 140 edge inputs), by the commands of their REPORT/COMMANDS.
# Copies and outputs under ~/dsh-work/s85-scratch/S4-rerun; node_modules hard-linked from s9sc (the installers edit
# only archived files: vitest.config.ts, src, tests and vendor/coding-agent/dist). (lead, 2026-10-22)
set -e
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
SL=/home/han001/dsh-work/slices; D=$SL/s9s85-S4; S=/home/han001/dsh-work/s85-scratch/S4-rerun; RC=/mnt/d/cc-lead-notes/impl/s85/probe-recover
test ! -e $S || { echo "$S exists"; exit 2; }
mkdir -p $S/probes
( cd $D/.dsh-scratch/S4/probes && find . -type f -size -1024k ! -path './*/logs/*' ! -name '*.jsonl' | while read f; do mkdir -p "$S/probes/$(dirname "$f")"; cp "$f" "$S/probes/$f"; done )
mk() {  # <name> <rev>
  mkdir -p $S/$1; git -C $D -c core.autocrlf=false archive $2 | tar -x -C $S/$1
  cp -al $SL/s9sc/node_modules $S/$1/node_modules; cp -al $SL/s9sc/vendor/coding-agent/node_modules $S/$1/vendor/coding-agent/node_modules
}
mk base-a s85-n2-base; mk result-a 39fee06; mk base-r s85-n2-base; mk result-r 39fee06
EA=$S/probes/e-assembler; ER=$S/probes/e-render
set +e
echo "== e-assembler: install"
for C in base-a result-a; do node $EA/apply-probes.mjs $S/$C > $S/ea-install-$C.txt 2>&1; echo "$C install exit $?"; done
echo "== e-assembler: capture base twice, result once"
bash $EA/run-capture.sh $S/base-a $S/ea-base-run1 $S/ea-base-run1.log > /dev/null 2>&1; echo "base-run1 exit $? $(tail -1 $S/ea-base-run1.log)"
bash $EA/run-capture.sh $S/base-a $S/ea-base-run2 $S/ea-base-run2.log > /dev/null 2>&1; echo "base-run2 exit $? $(tail -1 $S/ea-base-run2.log)"
bash $EA/run-capture.sh $S/result-a $S/ea-result $S/ea-result.log > /dev/null 2>&1; echo "result exit $? $(tail -1 $S/ea-result.log)"
DECL=; [ -f $EA/declared.json ] && DECL=--declared=$EA/declared.json
( cd $EA && node compare.mjs $S/ea-base-run1 $S/ea-base-run2 $DECL > $S/ea-base-vs-base.txt 2>&1; echo "base vs base exit $?"; tail -12 $S/ea-base-vs-base.txt )
( cd $EA && node compare.mjs $S/ea-base-run1 $S/ea-result $DECL > $S/ea-base-vs-result.txt 2>&1; echo "base vs result exit $?"; tail -12 $S/ea-base-vs-result.txt )
( cd $EA && node compare.mjs $S/ea-base-run1 $S/ea-result $DECL --result-only > $S/ea-base-vs-result-only.txt 2>&1; echo "base vs result (result-only) exit $?"; tail -12 $S/ea-base-vs-result-only.txt )
[ -f $EA/field-diff.mjs ] && ( cd $EA && node field-diff.mjs $S/ea-base-run1 $S/ea-base-run2 > $S/ea-fields-base12.txt 2>&1; node field-diff.mjs $S/ea-base-run1 $S/ea-result > $S/ea-fields-baseresult.txt 2>&1; echo "fields base12: $(tail -3 $S/ea-fields-base12.txt | tr '\n' ' ')"; echo "fields base-result: $(tail -3 $S/ea-fields-baseresult.txt | tr '\n' ' ')" )
echo "== e-assembler: replay base-run1 through the result"
bash $EA/run-replay.sh $S/result-a $S/ea-base-run1 $S/ea-replay-result $S/ea-replay-result.log > /dev/null 2>&1; echo "replay exit $? $(grep -E "Tests|groups|calls" $S/ea-replay-result.log | tail -3 | tr '
' ' ')"
echo "== e-render: install"
node $ER/apply-probe-base.mjs $S/base-r --check && node $ER/apply-probe-base.mjs $S/base-r; echo "base-r install exit $?"
node $ER/apply-probe-result.mjs $S/result-r --check && node $ER/apply-probe-result.mjs $S/result-r; echo "result-r install exit $?"
T1="tests/app/S3-attention-context.test.ts tests/business/S1-archive-flow.test.ts tests/composition/WP2-wiring.test.ts tests/contracts/A2-rework-contract-helpers.test.ts tests/runtime/K3-16-proposal-input.test.ts tests/runtime/K3-16-review-extremes-pure.test.ts tests/runtime/K3-35-manifest-trim-pure.test.ts tests/runtime/K3-35-workspace-baseline-prepare.test.ts tests/runtime/K3-B3-cancellation-cancelled.test.ts tests/runtime/K3-B3-runtime-fail-closed.test.ts"
T2="tests/runtime/K3-merge-cancel-propagation.test.ts tests/runtime/K3-review-input-pure.test.ts tests/runtime/K3-review-preparation.test.ts tests/runtime/K3-unknown-call-review-section.test.ts tests/runtime/S1-archive-files-brief.test.ts tests/runtime/S3-context-assembler.test.ts tests/runtime/S4C2-assembly.test.ts tests/runtime/WP1-context-assembly.test.ts tests/scenarios/K3-42-unexpanded-r2.test.ts tests/scenarios/S3-context-and-inputs.test.ts"
T3="tests/scenarios/S3-query-graph.test.ts tests/work-graph/K3-35-owner-manifest-trim.test.ts tests/work-graph/R5b-initial-plan.test.ts tests/work-graph/S3-role-profiles.test.ts tests/work-graph/S4C2-memory-material.test.ts tests/work-graph/S4C2-project-set-shared.test.ts tests/work-graph/S4C2-read-counts.test.ts tests/work-graph/S8A-L8-reminders-public.test.ts"
T4="tests/probes/planning-query.test.ts"
mkdir -p $S/er-logs
rec() {  # <copy> <name>
  for b in "$T1" "$T2" "$T3" "$T4"; do ( cd $S/$1 && S85_PROBE_LOG=$S/er-logs/$2 timeout 900 npx vitest run --maxWorkers=2 $b > /dev/null 2>&1; echo "$2 batch exit $?" ); done
  ( cd $ER && node combine.mjs $S/er-logs $2 $S/er-$2.jsonl > /dev/null 2>&1; echo "$2 combined $(wc -l < $S/er-$2.jsonl) records" )
}
echo "== e-render: record base twice"
rec base-r base-run1; rec base-r base-run2
EXP='renderContext,renderAttentionChanges,fact.effectiveDuty,fact.rolePayload,fact.goalPayload,fact.taskPayload,fact.queryFocusLines,fact.queryPlanSummary,fact.notImplementedExtensions,fact.noteSourcesOf,fact.declarationsForTask,fact.missingInputReminder,fact.optionalRowsFromExtensions,fact.annotations,fact.topLevelModuleCards,note.generalWarningLabel'
( cd $ER && node probe-counts.mjs $S/er-base-run1.jsonl --expect "$EXP" > $S/er-counts-base1.txt 2>&1; echo "counts base1 exit $?"; cat $S/er-counts-base1.txt | tail -20 )
( cd $ER && node determinism.mjs $S/er-base-run1.jsonl $S/er-base-run2.jsonl --report $S/er-base-determinism.json > $S/er-determinism.txt 2>&1; echo "determinism exit $?"; tail -6 $S/er-determinism.txt )
echo "== e-render: replay run 1 on base and result"
( cd $ER && node replay.mjs $S/base-r $S/er-base-run1.jsonl --out $S/er-replayed-base.jsonl --report $S/er-replay-base.json --label base-r > $S/er-replay-base.txt 2>&1; echo "replay base exit $?"; tail -4 $S/er-replay-base.txt )
( cd $ER && node replay.mjs $S/result-r $S/er-base-run1.jsonl --out $S/er-replayed-result.jsonl --report $S/er-replay-result.json --label result-r > $S/er-replay-result.txt 2>&1; echo "replay result exit $?"; tail -4 $S/er-replay-result.txt )
cmp $S/er-replayed-base.jsonl $S/er-replayed-result.jsonl && echo "replayed base = replayed result (bytes)"
echo "== e-render: edge inputs"
for C in base-r base-r2 result-r; do CC=${C%2}; ( cd $S/$CC && S85_EDGE_OUT=$S/er-edge-$C.jsonl S85_EDGE_LABEL=$CC timeout 900 npx vitest run --maxWorkers=2 tests/probes/edge.test.ts > $S/er-edge-$C.txt 2>&1; echo "edge $C exit $? $(wc -l < $S/er-edge-$C.jsonl) lines" ); done
cmp $S/er-edge-base-r.jsonl $S/er-edge-base-r2.jsonl && echo "edge base twice: same bytes"
( cd $ER && node compare-edge.mjs $S/er-edge-base-r.jsonl $S/er-edge-result-r.jsonl --report $S/er-edge-base-vs-result.json; echo "compare-edge exit $?" )
mkdir -p $RC/rerun-S4; cp $S/*.txt $S/*.log $S/*.json $RC/rerun-S4/ 2>/dev/null
echo done
