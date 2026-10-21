#!/bin/bash
# Rerun S3's D3a byte proofs (recovered probes, out-S3/files/probes/e1 and e2) on s85-base and the night-1 merge
# n1-merged, by the commands of e1/REPORT.md and e2/run-capture.sh / run-result.sh. Copies under
# ~/dsh-work/s85-scratch/S3-rerun; node_modules hard-linked from s9sc. (lead, 2026-10-21)
# e1: record base twice, determinism, replay run 1 on base and merge, edge cases on base and merge.
# e2: capture base twice and merge once, compare base-run1 with base-run2 and with merge.
set -e
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
SL=/home/han001/dsh-work/slices; S=/home/han001/dsh-work/s85-scratch/S3-rerun; RC=/mnt/d/cc-lead-notes/impl/s85/probe-recover
test ! -e $S || { echo "$S exists"; exit 2; }
mkdir -p $S
mk() {  # <copy name> <repo> <rev>
  mkdir -p $S/$1; git -C $2 -c core.autocrlf=false archive $3 | tar -x -C $S/$1
  cp -al $SL/s9sc/node_modules $S/$1/node_modules; cp -al $SL/s9sc/vendor/coding-agent/node_modules $S/$1/vendor/coding-agent/node_modules
}
mk base-e1 $SL/s9s85b s85-base; mk merge-e1 $SL/s9s85m n1-merged
mk base-e2 $SL/s9s85b s85-base; mk merge-e2 $SL/s9s85m n1-merged
cp -r $RC/out-S3/files/probes $S/probes
E1=$S/probes/e1; E2=$S/probes/e2
set +e
v() { systemd-run --user --scope -q --unit=s85-probe-S3-$1 -p MemoryMax=4G timeout 900 npx vitest run --maxWorkers=2 "${@:2}"; }
B1="tests/runtime/K3-15-blocked-sentence-pure.test.ts tests/runtime/K3-15-blocked-omission.test.ts tests/runtime/K3-16-approved-method-lines.test.ts tests/runtime/K3-16-proposal-input.test.ts tests/runtime/K3-16-proposal-tool.test.ts tests/runtime/K3-35-renderer-boundary-pure.test.ts tests/runtime/S5-user-message-tools.test.ts tests/work-graph/S3-role-profiles.test.ts tests/work-graph/S8A-L8-reminders-public.test.ts tests/work-graph/S4A-note-history.test.ts"
B2="tests/work-graph/S8A-L8-reminders-pure.test.ts tests/app/AG2-consultation.test.ts tests/app/S4C2-scribe-reminders.test.ts tests/work-graph/WP2-context-extensions.test.ts tests/work-graph/WP1-context-anomalies.test.ts tests/work-graph/K3-35-owner-manifest-trim.test.ts tests/runtime/K3-review-input-pure.test.ts tests/runtime/K3-35-manifest-trim-pure.test.ts tests/runtime/K3-15-disposition-effects-pure.test.ts tests/runtime/K3-16-review-extremes-pure.test.ts"
echo "== e1 install"
for C in base-e1 merge-e1; do node $E1/apply-probe.mjs $S/$C --check && node $E1/apply-probe.mjs $S/$C; echo "$C install exit $?"; done
echo "== e1 record base twice"
for R in base-run1 base-run2; do
  ( cd $S/base-e1 && S85_PROBE_LOG=$E1/$R v e1-$R-a $B1 > $S/e1-$R-a.txt 2>&1; echo "$R a exit $?"; S85_PROBE_LOG=$E1/$R v e1-$R-b $B2 > $S/e1-$R-b.txt 2>&1; echo "$R b exit $?" )
  ( cd $E1 && node combine.mjs . $R $R.jsonl; echo "$R combined $(wc -l < $E1/$R.jsonl) records" )
done
( cd $E1 && node --max-old-space-size=4096 determinism.mjs base-run1.jsonl base-run2.jsonl --report base-determinism.json; echo "determinism exit $?" )
echo "== e1 replay run 1 on base and merge"
for C in base-e1 merge-e1; do ( cd $E1 && node replay.mjs $S/$C base-run1.jsonl --out replayed-$C.jsonl --report replay-$C-report.json --label $C > $S/e1-replay-$C.txt 2>&1; echo "replay $C exit $?"; tail -3 $S/e1-replay-$C.txt ); done
cmp $E1/replayed-base-e1.jsonl $E1/replayed-merge-e1.jsonl && echo "replayed base = replayed merge (bytes)"
echo "== e1 edge cases"
for C in base-e1 merge-e1; do ( cd $S/$C && S85_EDGE_OUT=$E1/edge-$C.jsonl S85_EDGE_LABEL=$C v e1-edge-$C tests/probes/edge.test.ts > $S/e1-edge-$C.txt 2>&1; echo "edge $C exit $?" ); done
( cd $E1 && node compare-edge.mjs edge-base-e1.jsonl edge-merge-e1.jsonl --report edge-merge.json; echo "compare-edge exit $?" )
echo "== e2 install and capture"
for C in base-e2 merge-e2; do node $E2/apply-probes.mjs $S/$C; echo "$C install exit $?"; done
bash $E2/run-capture.sh $S/base-e2 $E2/base-run1 $S/e2-base-run1.log > /dev/null 2>&1; echo "e2 base-run1 exit $?"
bash $E2/run-capture.sh $S/base-e2 $E2/base-run2 $S/e2-base-run2.log > /dev/null 2>&1; echo "e2 base-run2 exit $?"
bash $E2/run-capture.sh $S/merge-e2 $E2/merge $S/e2-merge.log > /dev/null 2>&1; echo "e2 merge exit $?"
grep -h "^status=" $S/e2-*.log | sort | uniq -c
( cd $E2 && node compare.mjs base-run1 base-run2 > $S/e2-compare-base.txt 2>&1; echo "e2 base vs base exit $?"; tail -6 $S/e2-compare-base.txt )
( cd $E2 && node compare.mjs base-run1 merge > $S/e2-compare-merge.txt 2>&1; echo "e2 base vs merge exit $?"; tail -6 $S/e2-compare-merge.txt )
mkdir -p $RC/rerun-S3
cp $S/*.txt $S/*.log $RC/rerun-S3/ 2>/dev/null
cp $E1/base-determinism.json $E1/replay-*-report.json $E1/edge-merge.json $RC/rerun-S3/ 2>/dev/null
echo done
